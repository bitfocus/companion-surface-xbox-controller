import { createRequire } from 'node:module'
import { createModuleLogger } from '@companion-surface/base'
import type { GamepadState } from '../report.js'
import { normaliseSigned, normaliseUnsigned } from '../util.js'
import { ERROR_DEVICE_NOT_CONNECTED, ERROR_SUCCESS, XINPUT_BUTTON_BITS, XUSER_MAX_COUNT } from './types.js'
import type { ControllerButton } from '../models.js'

const require = createRequire(import.meta.url)
const logger = createModuleLogger('XInput/Driver')

interface RawXInputGamepad {
	wButtons: number
	bLeftTrigger: number
	bRightTrigger: number
	sThumbLX: number
	sThumbLY: number
	sThumbRX: number
	sThumbRY: number
}

interface RawXInputState {
	dwPacketNumber: number
	Gamepad: RawXInputGamepad
}

const XINPUT_MAX_THUMB = 32767
const XINPUT_MAX_TRIGGER = 255

type XInputGetStateFn = (dwUserIndex: number, pState: RawXInputState) => number

export class XInputDriver {
	#loaded = false
	#getStateFn: XInputGetStateFn | null = null

	public isAvailable(): boolean {
		return this.#ensureLoaded()
	}

	#ensureLoaded(): boolean {
		if (this.#loaded) return this.#getStateFn !== null
		this.#loaded = true

		if (process.platform !== 'win32') return false

		try {
			// Dynamically require koffi
			const koffi = require('koffi')

			const XINPUT_GAMEPAD = koffi.struct('XINPUT_GAMEPAD', {
				wButtons: 'uint16',
				bLeftTrigger: 'uint8',
				bRightTrigger: 'uint8',
				sThumbLX: 'int16',
				sThumbLY: 'int16',
				sThumbRX: 'int16',
				sThumbRY: 'int16',
			})

			const XINPUT_STATE = koffi.struct('XINPUT_STATE', {
				dwPacketNumber: 'uint32',
				Gamepad: XINPUT_GAMEPAD,
			})

			const candidateDlls = ['xinput1_4.dll', 'xinput1_3.dll', 'xinput9_1_0.dll']
			let lib: any = null

			for (const dll of candidateDlls) {
				try {
					lib = koffi.load(dll)
					if (lib) {
						logger.debug(`Loaded XInput library: ${dll}`)
						break
					}
				} catch {
					// try next
				}
			}

			if (!lib) {
				logger.debug('No XInput DLL found on system')
				return false
			}

			// Try ordinal 100 for XInputGetStateEx (includes Xbox Guide button bit)
			try {
				const fnEx = lib.func('__stdcall', 100, 'uint32_t', ['uint32_t', koffi.out(koffi.pointer(XINPUT_STATE))])
				if (fnEx) {
					this.#getStateFn = fnEx
					logger.debug('Using XInputGetStateEx (ordinal 100) with Guide button support')
					return true
				}
			} catch {
				// fallback to standard XInputGetState
			}

			try {
				const fn = lib.func('__stdcall', 'XInputGetState', 'uint32_t', [
					'uint32_t',
					koffi.out(koffi.pointer(XINPUT_STATE)),
				])
				if (fn) {
					this.#getStateFn = fn
					logger.debug('Using standard XInputGetState')
					return true
				}
			} catch (err) {
				logger.warn(`Failed to bind XInputGetState: ${err}`)
			}
		} catch (err) {
			logger.warn(`Failed to initialize Koffi XInput driver: ${err}`)
		}

		return false
	}

	public poll(userIndex: number, target: GamepadState): boolean {
		if (userIndex < 0 || userIndex >= XUSER_MAX_COUNT) return false
		if (!this.#ensureLoaded() || !this.#getStateFn) return false

		const rawState: RawXInputState = {
			dwPacketNumber: 0,
			Gamepad: {
				wButtons: 0,
				bLeftTrigger: 0,
				bRightTrigger: 0,
				sThumbLX: 0,
				sThumbLY: 0,
				sThumbRX: 0,
				sThumbRY: 0,
			},
		}

		const result = this.#getStateFn(userIndex, rawState)
		if (result === ERROR_DEVICE_NOT_CONNECTED) {
			return false
		}
		if (result !== ERROR_SUCCESS) {
			return false
		}

		const gp = rawState.Gamepad

		// Map buttons
		for (const [btn, mask] of Object.entries(XINPUT_BUTTON_BITS) as [ControllerButton, number][]) {
			if (mask !== 0) {
				target.buttons[btn] = (gp.wButtons & mask) !== 0
			}
		}

		// Map triggers (0..255 -> 0..1)
		target.axes.leftTrigger = normaliseUnsigned(gp.bLeftTrigger, XINPUT_MAX_TRIGGER)
		target.axes.rightTrigger = normaliseUnsigned(gp.bRightTrigger, XINPUT_MAX_TRIGGER)

		// Map sticks (-32768..32767 -> -1..1, up is positive)
		target.axes.leftX = normaliseSigned(gp.sThumbLX, XINPUT_MAX_THUMB)
		target.axes.leftY = normaliseSigned(gp.sThumbLY, XINPUT_MAX_THUMB)
		target.axes.rightX = normaliseSigned(gp.sThumbRX, XINPUT_MAX_THUMB)
		target.axes.rightY = normaliseSigned(gp.sThumbRY, XINPUT_MAX_THUMB)

		return true
	}
}

export const sharedXInputDriver = new XInputDriver()
