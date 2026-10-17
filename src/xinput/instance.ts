import {
	CardGenerator,
	HostCapabilities,
	SurfaceDrawProps,
	SurfaceContext,
	SurfaceInstance,
	createModuleLogger,
	ModuleLogger,
} from '@companion-surface/base'
import { applyDeadzone, controlKeyToId, roundTo } from '../util.js'
import {
	type ControlKey,
	type ControllerAxis,
	type ControllerButton,
	type ControllerModelInfo,
	type RotaryControl,
	type StickDirectionControl,
	type TriggerControl,
	ROTARY_AXES,
	STICK_DIRECTIONS,
} from '../models.js'
import { createEmptyState, type GamepadState } from '../report.js'
import { DEFAULT_CONFIG, parseConfig, type XboxControllerConfig } from '../config.js'
import { AXIS_VARIABLES } from '../variables.js'
import { sharedXInputDriver } from './driver.js'
import type { XInputDeviceInfo } from './types.js'

const TRIGGERS: TriggerControl[] = ['leftTrigger', 'rightTrigger']

/** Release at this fraction of the press threshold, so a stick held near the edge doesn't chatter */
const RELEASE_RATIO = 0.7

/** Stick travel is bucketed into this many speeds, so small wobbles don't rebuild the repeat timer */
const ROTARY_LEVELS = 8
/** Rotation events per second at the slowest bucket */
const ROTARY_MIN_RATE = 2

/** Analog values are coalesced and sent at most this often, in ms */
const VARIABLE_FLUSH_INTERVAL = 50
const VARIABLE_DECIMALS = 3

/** Polling frequency for XInput controller state (~60 Hz) */
const XINPUT_POLL_INTERVAL_MS = 16

interface RotaryState {
	level: number
	interval: ReturnType<typeof setInterval> | undefined
}

export class XboxXInputSurfaceWrapper implements SurfaceInstance {
	readonly #logger: ModuleLogger

	readonly #userIndex: number
	readonly #modelInfo: ControllerModelInfo
	readonly #productName: string

	readonly #surfaceId: string
	readonly #context: SurfaceContext

	#config: XboxControllerConfig = { ...DEFAULT_CONFIG }

	readonly #state: GamepadState = createEmptyState()
	/** Logical pressed state per control, after thresholding */
	readonly #pressed = new Map<ControlKey, boolean>()
	readonly #rotaries = new Map<RotaryControl, RotaryState>()

	readonly #pendingVariables = new Map<string, number>()
	readonly #sentVariables = new Map<string, number>()
	#variableFlush: ReturnType<typeof setTimeout> | undefined

	#pollTimer: ReturnType<typeof setInterval> | undefined
	#closed = false
	#disconnectCount = 0

	public get surfaceId(): string {
		return this.#surfaceId
	}
	public get productName(): string {
		return this.#productName
	}

	public constructor(
		surfaceId: string,
		deviceInfo: XInputDeviceInfo,
		info: ControllerModelInfo,
		context: SurfaceContext,
	) {
		this.#logger = createModuleLogger(`Instance/${surfaceId}`)
		this.#userIndex = deviceInfo.userIndex
		this.#modelInfo = info
		this.#productName = deviceInfo.name
		this.#surfaceId = surfaceId
		this.#context = context

		// Prime the variable cache with deadzone-adjusted initial readings (zeros)
		for (const [axis, variableId] of Object.entries(AXIS_VARIABLES) as [ControllerAxis, string][]) {
			this.#sentVariables.set(variableId, applyDeadzone(this.#state.axes[axis], this.#config.stickDeadzone))
		}
	}

	#warnedLocked = false

	#checkLocked(): boolean {
		if (this.#context.isLocked) {
			if (!this.#warnedLocked) {
				this.#warnedLocked = true
				this.#logger.warn(
					'Surface is currently LOCKED by Companion (PIN lockout is active). In Companion Surfaces tab, select this controller and enable "Never lock this surface" to receive button and variable inputs.',
				)
			}
			return true
		}
		this.#warnedLocked = false
		return false
	}

	#poll(): void {
		if (this.#closed) return

		const isConnected = sharedXInputDriver.poll(this.#userIndex, this.#state)
		if (!isConnected) {
			this.#disconnectCount++
			if (this.#disconnectCount > 10) {
				this.#logger.warn(`XInput Player ${this.#userIndex + 1} disconnected`)
				this.#closed = true
				this.#stopAllTimers()
				this.#context.disconnect(new Error('XInput controller disconnected'))
			}
			return
		}

		this.#disconnectCount = 0
		this.#applyState()
	}

	#applyState(): void {
		this.#applyButtons()
		this.#applyTriggers()
		this.#applyStickDirections()
		this.#applyRotaries()
		this.#applyVariables()
	}

	#applyButtons(): void {
		for (const [button, isDown] of Object.entries(this.#state.buttons)) {
			this.#setPressed(button as ControllerButton, isDown)
		}
	}

	#applyTriggers(): void {
		for (const trigger of TRIGGERS) {
			const value = applyDeadzone(this.#state.axes[trigger], this.#config.stickDeadzone)
			this.#setPressed(trigger, this.#isPastThreshold(trigger, value))
		}
	}

	#applyStickDirections(): void {
		for (const [control, { axis, negative }] of Object.entries(STICK_DIRECTIONS) as [
			StickDirectionControl,
			{ axis: ControllerAxis; negative: boolean },
		][]) {
			const value = applyDeadzone(this.#state.axes[axis], this.#config.stickDeadzone)
			const travel = negative ? Math.max(-value, 0) : Math.max(value, 0)
			this.#setPressed(control, this.#isPastThreshold(control, travel))
		}
	}

	#applyRotaries(): void {
		for (const [control, axis] of Object.entries(ROTARY_AXES) as [RotaryControl, ControllerAxis][]) {
			const value = applyDeadzone(this.#state.axes[axis], this.#config.stickDeadzone)
			const level = Math.round(value * ROTARY_LEVELS)
			this.#setRotaryLevel(control, level)
		}
	}

	#applyVariables(): void {
		for (const [axis, variableId] of Object.entries(AXIS_VARIABLES) as [ControllerAxis, string][]) {
			const value = roundTo(applyDeadzone(this.#state.axes[axis], this.#config.stickDeadzone), VARIABLE_DECIMALS)
			if (this.#sentVariables.get(variableId) === value) continue

			this.#pendingVariables.set(variableId, value)
		}

		this.#scheduleVariableFlush()
	}

	#isPastThreshold(key: ControlKey, magnitude: number): boolean {
		const wasPressed = this.#pressed.get(key) ?? false

		return wasPressed
			? magnitude > this.#config.pressThreshold * RELEASE_RATIO
			: magnitude >= this.#config.pressThreshold
	}

	#setPressed(key: ControlKey, pressed: boolean): void {
		if ((this.#pressed.get(key) ?? false) === pressed) return
		this.#pressed.set(key, pressed)

		const controlId = controlKeyToId(this.#modelInfo, key)
		if (!controlId) return

		if (this.#checkLocked()) return

		if (pressed) {
			this.#context.keyDownById(controlId)
		} else {
			this.#context.keyUpById(controlId)
		}
	}

	#setRotaryLevel(control: RotaryControl, level: number): void {
		const existing = this.#rotaries.get(control)
		const previousLevel = existing?.level ?? 0
		if (previousLevel === level) return

		if (existing?.interval !== undefined) clearInterval(existing.interval)

		const controlId = controlKeyToId(this.#modelInfo, control)
		if (level === 0 || !controlId) {
			this.#rotaries.set(control, { level, interval: undefined })
			return
		}

		if (this.#checkLocked()) return

		const rotateRight = level > 0
		const emit = () => {
			if (rotateRight) {
				this.#context.rotateRightById(controlId)
			} else {
				this.#context.rotateLeftById(controlId)
			}
		}

		if (previousLevel === 0 || Math.sign(previousLevel) !== Math.sign(level)) emit()

		const maxRate = this.#config.rotaryMaxRate
		const minRate = Math.min(ROTARY_MIN_RATE, maxRate)
		const rate = minRate + (maxRate - minRate) * (Math.abs(level) / ROTARY_LEVELS)

		this.#rotaries.set(control, { level, interval: setInterval(emit, 1000 / rate) })
	}

	#scheduleVariableFlush(): void {
		if (this.#variableFlush !== undefined || this.#pendingVariables.size === 0) return

		this.#variableFlush = setTimeout(() => {
			this.#variableFlush = undefined
			if (this.#closed) return

			if (this.#checkLocked()) return

			for (const [variableId, value] of this.#pendingVariables) {
				this.#sentVariables.set(variableId, value)
				this.#context.sendVariableValue(variableId, value)
			}
			this.#pendingVariables.clear()
		}, VARIABLE_FLUSH_INTERVAL)
	}

	#stopRotaries(): void {
		for (const [control, rotary] of this.#rotaries) {
			if (rotary.interval !== undefined) clearInterval(rotary.interval)
			this.#rotaries.set(control, { level: 0, interval: undefined })
		}
	}

	#stopAllTimers(): void {
		this.#stopRotaries()

		if (this.#pollTimer !== undefined) {
			clearInterval(this.#pollTimer)
			this.#pollTimer = undefined
		}

		if (this.#variableFlush !== undefined) {
			clearTimeout(this.#variableFlush)
			this.#variableFlush = undefined
		}
	}

	async init(): Promise<void> {
		this.#logger.debug(`Starting XInput polling loop for ${this.#productName}`)
		this.#pollTimer = setInterval(() => {
			this.#poll()
		}, XINPUT_POLL_INTERVAL_MS)
	}

	async close(): Promise<void> {
		this.#closed = true
		this.#stopAllTimers()
	}

	async updateConfig(config: Record<string, any>): Promise<void> {
		this.#config = parseConfig(config)
		this.#logger.debug(
			`Config updated: deadzone ${this.#config.stickDeadzone}, threshold ${this.#config.pressThreshold}, max rate ${this.#config.rotaryMaxRate}`,
		)

		this.#stopRotaries()
		this.#applyState()
	}

	async ready(): Promise<void> {
		// Nothing to do
	}

	updateCapabilities(_capabilities: HostCapabilities): void {
		// Not used
	}

	async setBrightness(_percent: number): Promise<void> {
		// No display to dim
	}
	async blank(): Promise<void> {
		// No display to blank
	}
	async draw(_signal: AbortSignal, _drawProps: SurfaceDrawProps): Promise<void> {
		// No display to draw to
	}
	async showStatus(_signal: AbortSignal, _cardGenerator: CardGenerator): Promise<void> {
		// No display to show status on
	}
}
