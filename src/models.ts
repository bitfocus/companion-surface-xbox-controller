/**
 * How the controller's inputs are arranged onto the Companion surface grid.
 *
 * A gamepad has no display, so the grid is purely a naming scheme for bindings. Rather than
 * trying to draw a controller shape in a grid, the rows are grouped by function, which is far
 * easier to read in the Companion UI:
 *
 *          col 0     col 1     col 2     col 3     col 4      col 5      col 6      col 7
 *   row 0  A         B         X         Y         LB         RB         LT         RT
 *   row 1  D-Up      D-Down    D-Left    D-Right   View       Menu       Xbox       Share
 *   row 2  LS-Up     LS-Down   LS-Left   LS-Right  LS-Click   LS-X       LS-Y
 *   row 3  RS-Up     RS-Down   RS-Left   RS-Right  RS-Click   RS-X       RS-Y
 *
 * The analog inputs appear twice on purpose, because the two treatments suit different jobs:
 * the LS-Up/Down/Left/Right cells act as buttons once the stick is pushed past a threshold
 * (good for nudging a PTZ camera), while the LS-X/LS-Y cells emit repeating rotation events
 * at a rate proportional to how far the stick is pushed (good for scrubbing or volume).
 */

/** [column, row] — the same ordering the Contour Shuttle surface uses, reversed from the admin UI */
export type ControlPosition = [number, number]

/** The digital buttons, named as they are on the controller */
export type ControllerButton =
	| 'a'
	| 'b'
	| 'x'
	| 'y'
	| 'lb'
	| 'rb'
	| 'view'
	| 'menu'
	| 'xbox'
	| 'share'
	| 'leftStickClick'
	| 'rightStickClick'
	| 'dpadUp'
	| 'dpadDown'
	| 'dpadLeft'
	| 'dpadRight'

/** The analog inputs. Sticks report -1..1, triggers report 0..1 */
export type ControllerAxis = 'leftX' | 'leftY' | 'rightX' | 'rightY' | 'leftTrigger' | 'rightTrigger'

/** Triggers are analog, but also act as buttons once pressed past a threshold */
export type TriggerControl = 'leftTrigger' | 'rightTrigger'

/** Sticks act as four buttons each, once pushed past a threshold */
export type StickDirectionControl =
	| 'leftStickUp'
	| 'leftStickDown'
	| 'leftStickLeft'
	| 'leftStickRight'
	| 'rightStickUp'
	| 'rightStickDown'
	| 'rightStickLeft'
	| 'rightStickRight'

/** Stick axes also drive a rotary control, which emits repeating rotation events */
export type RotaryControl = 'leftStickXRotary' | 'leftStickYRotary' | 'rightStickXRotary' | 'rightStickYRotary'

export type ControlKey = ControllerButton | TriggerControl | StickDirectionControl | RotaryControl

export interface ControllerModelInfo {
	controls: Record<ControlKey, ControlPosition>
}

/**
 * Which stick and sign each direction button watches. Axes are normalised so that up and right
 * are positive, so `negative` marks the down and left directions.
 */
export const STICK_DIRECTIONS: Record<StickDirectionControl, { axis: ControllerAxis; negative: boolean }> = {
	leftStickUp: { axis: 'leftY', negative: false },
	leftStickDown: { axis: 'leftY', negative: true },
	leftStickLeft: { axis: 'leftX', negative: true },
	leftStickRight: { axis: 'leftX', negative: false },
	rightStickUp: { axis: 'rightY', negative: false },
	rightStickDown: { axis: 'rightY', negative: true },
	rightStickLeft: { axis: 'rightX', negative: true },
	rightStickRight: { axis: 'rightX', negative: false },
}

/** Which axis each rotary control follows */
export const ROTARY_AXES: Record<RotaryControl, ControllerAxis> = {
	leftStickXRotary: 'leftX',
	leftStickYRotary: 'leftY',
	rightStickXRotary: 'rightX',
	rightStickYRotary: 'rightY',
}

export const xboxControllerInfo: ControllerModelInfo = {
	controls: {
		// row 0 — face buttons, bumpers, triggers
		a: [0, 0],
		b: [1, 0],
		x: [2, 0],
		y: [3, 0],
		lb: [4, 0],
		rb: [5, 0],
		leftTrigger: [6, 0],
		rightTrigger: [7, 0],

		// row 1 — d-pad and system buttons
		dpadUp: [0, 1],
		dpadDown: [1, 1],
		dpadLeft: [2, 1],
		dpadRight: [3, 1],
		view: [4, 1],
		menu: [5, 1],
		xbox: [6, 1],
		share: [7, 1],

		// row 2 — left stick
		leftStickUp: [0, 2],
		leftStickDown: [1, 2],
		leftStickLeft: [2, 2],
		leftStickRight: [3, 2],
		leftStickClick: [4, 2],
		leftStickXRotary: [5, 2],
		leftStickYRotary: [6, 2],

		// row 3 — right stick
		rightStickUp: [0, 3],
		rightStickDown: [1, 3],
		rightStickLeft: [2, 3],
		rightStickRight: [3, 3],
		rightStickClick: [4, 3],
		rightStickXRotary: [5, 3],
		rightStickYRotary: [6, 3],
	},
}
