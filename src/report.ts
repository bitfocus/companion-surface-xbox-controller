import type { ControllerAxis, ControllerButton } from './models.js'
import { normaliseSigned, normaliseUnsigned } from './util.js'

export interface GamepadState {
	buttons: Record<ControllerButton, boolean>
	/** Sticks are -1..1 with 0 at centre; triggers are 0..1 */
	axes: Record<ControllerAxis, number>
}

export function createEmptyState(): GamepadState {
	return {
		buttons: {
			a: false,
			b: false,
			x: false,
			y: false,
			lb: false,
			rb: false,
			view: false,
			menu: false,
			xbox: false,
			share: false,
			leftStickClick: false,
			rightStickClick: false,
			dpadUp: false,
			dpadDown: false,
			dpadLeft: false,
			dpadRight: false,
		},
		axes: {
			leftX: 0,
			leftY: 0,
			rightX: 0,
			rightY: 0,
			leftTrigger: 0,
			rightTrigger: 0,
		},
	}
}

/**
 * A controller reports in one of two quite different shapes, depending on how it is attached, and
 * the leading byte tells us which we have.
 *
 * Over USB it does not speak HID at all — it speaks Microsoft's GIP protocol, and the operating
 * system hands those frames to us as HID reports. Over Bluetooth it is an ordinary HID gamepad with
 * a numbered report instead.
 *
 * The GIP layout below was read off a Series X|S controller over USB on macOS. The Bluetooth layout
 * has not been verified on hardware yet.
 */
const GIP_COMMAND_INPUT = 0x20
const GIP_COMMAND_GUIDE = 0x07
const BLUETOOTH_REPORT_ID = 0x01

/** Byte offsets within a GIP input frame */
const OFFSET = {
	buttons: 4,
	leftTrigger: 6,
	rightTrigger: 8,
	leftX: 10,
	leftY: 12,
	rightX: 14,
	rightY: 16,
} as const

/** An input frame is at least this long; anything shorter cannot hold the sticks */
const INPUT_FRAME_LENGTH = 18

/** A guide frame carries the button state in a single byte */
const GUIDE_OFFSET_STATE = 4
const GUIDE_FRAME_LENGTH = 5

/** Sticks are signed and reach this at full travel; triggers are unsigned 10-bit */
const STICK_MAX = 32767
const TRIGGER_MAX = 1023

/**
 * Bit positions within the 16-bit button field of a GIP input frame.
 *
 * The d-pad is part of this field rather than a separate hat switch, so diagonals come through
 * as two bits set at once and need no special handling.
 */
const BUTTON_BITS: Partial<Record<ControllerButton, number>> = {
	menu: 1 << 2,
	view: 1 << 3,
	a: 1 << 4,
	b: 1 << 5,
	x: 1 << 6,
	y: 1 << 7,
	dpadUp: 1 << 8,
	dpadDown: 1 << 9,
	dpadLeft: 1 << 10,
	dpadRight: 1 << 11,
	lb: 1 << 12,
	rb: 1 << 13,
	leftStickClick: 1 << 14,
	rightStickClick: 1 << 15,
}

/**
 * Byte offsets within a Bluetooth HID report, relative to the start of the report body — that is,
 * after the report id. Sticks are unsigned here, centred at half scale, and the d-pad is a hat
 * switch rather than part of the button field.
 */
const BLUETOOTH_OFFSET = {
	leftX: 0,
	leftY: 2,
	rightX: 4,
	rightY: 6,
	leftTrigger: 8,
	rightTrigger: 10,
	dpad: 12,
	buttons1: 13,
	buttons2: 14,
	buttons3: 15,
} as const

const BLUETOOTH_BODY_LENGTH = 16
const BLUETOOTH_STICK_MAX = 65535

const BLUETOOTH_BUTTONS1_BITS: Partial<Record<ControllerButton, number>> = {
	a: 0x01,
	b: 0x02,
	x: 0x08,
	y: 0x10,
	lb: 0x40,
	rb: 0x80,
}

const BLUETOOTH_BUTTONS2_BITS: Partial<Record<ControllerButton, number>> = {
	view: 0x04,
	menu: 0x08,
	xbox: 0x10,
	leftStickClick: 0x20,
	rightStickClick: 0x40,
}

/**
 * The d-pad hat: 0 for centred, then 1-8 running clockwise from up.
 */
const DPAD_DIRECTIONS: Record<number, ControllerButton[]> = {
	1: ['dpadUp'],
	2: ['dpadUp', 'dpadRight'],
	3: ['dpadRight'],
	4: ['dpadDown', 'dpadRight'],
	5: ['dpadDown'],
	6: ['dpadDown', 'dpadLeft'],
	7: ['dpadLeft'],
	8: ['dpadUp', 'dpadLeft'],
}

/**
 * Decode a frame into `state`, mutating it in place.
 * @returns true if the frame was understood
 */
export function parseInputReport(data: Buffer, state: GamepadState): boolean {
	if (data.length >= GUIDE_FRAME_LENGTH && data[0] === GIP_COMMAND_GUIDE) {
		// The Xbox button arrives on its own, in a frame of its own. macOS repeats each one several
		// times, which callers absorb by only acting on changes.
		state.buttons.xbox = data[GUIDE_OFFSET_STATE] !== 0
		return true
	}

	if (data.length >= INPUT_FRAME_LENGTH && data[0] === GIP_COMMAND_INPUT) {
		const buttons = data.readUInt16LE(OFFSET.buttons)
		for (const [button, mask] of Object.entries(BUTTON_BITS)) {
			state.buttons[button as ControllerButton] = (buttons & mask) !== 0
		}

		state.axes.leftTrigger = normaliseUnsigned(data.readUInt16LE(OFFSET.leftTrigger), TRIGGER_MAX)
		state.axes.rightTrigger = normaliseUnsigned(data.readUInt16LE(OFFSET.rightTrigger), TRIGGER_MAX)

		state.axes.leftX = normaliseSigned(data.readInt16LE(OFFSET.leftX), STICK_MAX)
		state.axes.leftY = normaliseSigned(data.readInt16LE(OFFSET.leftY), STICK_MAX)
		state.axes.rightX = normaliseSigned(data.readInt16LE(OFFSET.rightX), STICK_MAX)
		state.axes.rightY = normaliseSigned(data.readInt16LE(OFFSET.rightY), STICK_MAX)

		return true
	}

	if (data.length >= BLUETOOTH_BODY_LENGTH + 1 && data[0] === BLUETOOTH_REPORT_ID) {
		return parseBluetoothReport(data.subarray(1), state)
	}

	return false
}

function parseBluetoothReport(body: Buffer, state: GamepadState): boolean {
	// Centre reads as half scale, so shift it to sit on zero. Y is positive-downwards over
	// Bluetooth, unlike GIP, so it gets flipped to keep "up is positive" everywhere downstream.
	const stick = (offset: number) =>
		normaliseSigned(body.readUInt16LE(offset) - BLUETOOTH_STICK_MAX / 2, BLUETOOTH_STICK_MAX / 2)

	state.axes.leftX = stick(BLUETOOTH_OFFSET.leftX)
	state.axes.leftY = -stick(BLUETOOTH_OFFSET.leftY)
	state.axes.rightX = stick(BLUETOOTH_OFFSET.rightX)
	state.axes.rightY = -stick(BLUETOOTH_OFFSET.rightY)

	state.axes.leftTrigger = normaliseUnsigned(body.readUInt16LE(BLUETOOTH_OFFSET.leftTrigger), TRIGGER_MAX)
	state.axes.rightTrigger = normaliseUnsigned(body.readUInt16LE(BLUETOOTH_OFFSET.rightTrigger), TRIGGER_MAX)

	const buttons1 = body[BLUETOOTH_OFFSET.buttons1]
	const buttons2 = body[BLUETOOTH_OFFSET.buttons2]

	for (const [button, mask] of Object.entries(BLUETOOTH_BUTTONS1_BITS)) {
		state.buttons[button as ControllerButton] = (buttons1 & mask) !== 0
	}
	for (const [button, mask] of Object.entries(BLUETOOTH_BUTTONS2_BITS)) {
		state.buttons[button as ControllerButton] = (buttons2 & mask) !== 0
	}
	state.buttons.share = (body[BLUETOOTH_OFFSET.buttons3] & 0x01) !== 0

	state.buttons.dpadUp = false
	state.buttons.dpadDown = false
	state.buttons.dpadLeft = false
	state.buttons.dpadRight = false
	for (const button of DPAD_DIRECTIONS[body[BLUETOOTH_OFFSET.dpad]] ?? []) {
		state.buttons[button] = true
	}

	return true
}
