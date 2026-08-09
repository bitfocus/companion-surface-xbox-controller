import {
	CardGenerator,
	HostCapabilities,
	SurfaceDrawProps,
	SurfaceContext,
	SurfaceInstance,
	createModuleLogger,
	ModuleLogger,
} from '@companion-surface/base'
import type { HIDAsync } from 'node-hid'
import { applyDeadzone, controlKeyToId, roundTo } from './util.js'
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
} from './models.js'
import { createEmptyState, parseInputReport, type GamepadState } from './report.js'
import { DEFAULT_CONFIG, parseConfig, type XboxControllerConfig } from './config.js'
import { AXIS_VARIABLES } from './variables.js'

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

interface RotaryState {
	/** Signed speed bucket: 0 when centred, otherwise -ROTARY_LEVELS..ROTARY_LEVELS */
	level: number
	interval: ReturnType<typeof setInterval> | undefined
}

export class XboxControllerWrapper implements SurfaceInstance {
	readonly #logger: ModuleLogger

	readonly #device: HIDAsync
	readonly #modelInfo: ControllerModelInfo
	readonly #productName: string

	readonly #surfaceId: string
	readonly #context: SurfaceContext

	#config: XboxControllerConfig = { ...DEFAULT_CONFIG }

	readonly #state: GamepadState = createEmptyState()
	/** Logical pressed state per control, after thresholding — the source of truth for key events */
	readonly #pressed = new Map<ControlKey, boolean>()
	readonly #rotaries = new Map<RotaryControl, RotaryState>()

	readonly #pendingVariables = new Map<string, number>()
	readonly #sentVariables = new Map<string, number>()
	#variableFlush: ReturnType<typeof setTimeout> | undefined

	#closed = false

	public get surfaceId(): string {
		return this.#surfaceId
	}
	public get productName(): string {
		return this.#productName
	}

	public constructor(
		surfaceId: string,
		device: HIDAsync,
		info: ControllerModelInfo,
		productName: string,
		context: SurfaceContext,
	) {
		this.#logger = createModuleLogger(`Instance/${surfaceId}`)
		this.#device = device
		this.#modelInfo = info
		this.#productName = productName
		this.#surfaceId = surfaceId
		this.#context = context

		this.#device.on('data', (data: Buffer) => {
			if (this.#closed) return

			if (!parseInputReport(data, this.#state)) {
				this.#logger.debug(`Ignoring unrecognised report of ${data.length} bytes`)
				return
			}

			this.#applyState()
		})

		this.#device.on('error', (error: Error) => {
			if (this.#closed) return

			this.#logger.error(`Controller error: ${error}`)
			this.#stopAllTimers()
			this.#context.disconnect(error)
		})
	}

	/** Push the current controller state out as key, rotation and variable events */
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
			// Each direction only sees travel towards its own end of the axis
			const travel = negative ? Math.max(-value, 0) : Math.max(value, 0)
			this.#setPressed(control, this.#isPastThreshold(control, travel))
		}
	}

	#applyRotaries(): void {
		for (const [control, axis] of Object.entries(ROTARY_AXES) as [RotaryControl, ControllerAxis][]) {
			const value = applyDeadzone(this.#state.axes[axis], this.#config.stickDeadzone)
			const magnitude = Math.abs(value)
			const level = magnitude === 0 ? 0 : Math.ceil(magnitude * ROTARY_LEVELS) * Math.sign(value)

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

	/**
	 * Apply the press threshold with hysteresis: it takes the full threshold to press, but a
	 * lower one to release again.
	 */
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

		const rotateRight = level > 0
		const emit = () => {
			if (rotateRight) {
				this.#context.rotateRightById(controlId)
			} else {
				this.#context.rotateLeftById(controlId)
			}
		}

		// Fire immediately when leaving centre or reversing, so the first nudge feels instant
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

		if (this.#variableFlush !== undefined) {
			clearTimeout(this.#variableFlush)
			this.#variableFlush = undefined
		}
	}

	async init(): Promise<void> {
		// The device was opened before this instance was constructed
	}

	async close(): Promise<void> {
		this.#closed = true
		this.#stopAllTimers()

		await this.#device.close().catch((e) => {
			this.#logger.error(`Failed to close controller: ${e}`)
		})
	}

	async updateConfig(config: Record<string, any>): Promise<void> {
		this.#config = parseConfig(config)
		this.#logger.debug(
			`Config updated: deadzone ${this.#config.stickDeadzone}, threshold ${this.#config.pressThreshold}, max rate ${this.#config.rotaryMaxRate}`,
		)

		// Rebuild from the current state so the new deadzone and rates take effect at once,
		// rather than waiting for the next time something moves
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
