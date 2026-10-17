import type { ControllerButton } from '../models.js'

export interface XInputDeviceInfo {
	transport: 'xinput'
	userIndex: number
	name: string
}

export const XUSER_MAX_COUNT = 4
export const ERROR_SUCCESS = 0
export const ERROR_DEVICE_NOT_CONNECTED = 1167

/**
 * Standard XInput button bitmasks.
 * Guide button is bit 0x0400 exposed via XInputGetStateEx (ordinal 100).
 */
export const XINPUT_BUTTON_BITS: Record<ControllerButton, number> = {
	dpadUp: 0x0001,
	dpadDown: 0x0002,
	dpadLeft: 0x0004,
	dpadRight: 0x0008,
	menu: 0x0010, // Start / Menu
	view: 0x0020, // Back / View
	leftStickClick: 0x0040, // LS Click
	rightStickClick: 0x0080, // RS Click
	lb: 0x0100,
	rb: 0x0200,
	xbox: 0x0400, // Guide / Home (available via XInputGetStateEx)
	a: 0x1000,
	b: 0x2000,
	x: 0x4000,
	y: 0x8000,
	share: 0, // Not exposed in legacy XInput bitmask
}
