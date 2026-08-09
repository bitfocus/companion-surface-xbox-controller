import type { SurfaceInputVariable } from '@companion-surface/base'
import type { ControllerAxis } from './models.js'

/** Which transfer variable each analog input reports into */
export const AXIS_VARIABLES: Record<ControllerAxis, string> = {
	leftX: 'leftStickXVariable',
	leftY: 'leftStickYVariable',
	rightX: 'rightStickXVariable',
	rightY: 'rightStickYVariable',
	leftTrigger: 'leftTriggerVariable',
	rightTrigger: 'rightTriggerVariable',
}

const STICK_DESCRIPTION =
	'Ranges from -1 to 1, with 0 at rest. Use an expression to convert it into whatever range you need.'
const TRIGGER_DESCRIPTION = 'Ranges from 0 when released to 1 when squeezed fully.'

export const transferVariables: SurfaceInputVariable[] = [
	{
		id: AXIS_VARIABLES.leftX,
		type: 'input',
		name: 'Variable to store Left Stick X to',
		description: `${STICK_DESCRIPTION} Negative is left, positive is right.`,
	},
	{
		id: AXIS_VARIABLES.leftY,
		type: 'input',
		name: 'Variable to store Left Stick Y to',
		description: `${STICK_DESCRIPTION} Negative is down, positive is up.`,
	},
	{
		id: AXIS_VARIABLES.rightX,
		type: 'input',
		name: 'Variable to store Right Stick X to',
		description: `${STICK_DESCRIPTION} Negative is left, positive is right.`,
	},
	{
		id: AXIS_VARIABLES.rightY,
		type: 'input',
		name: 'Variable to store Right Stick Y to',
		description: `${STICK_DESCRIPTION} Negative is down, positive is up.`,
	},
	{
		id: AXIS_VARIABLES.leftTrigger,
		type: 'input',
		name: 'Variable to store Left Trigger to',
		description: TRIGGER_DESCRIPTION,
	},
	{
		id: AXIS_VARIABLES.rightTrigger,
		type: 'input',
		name: 'Variable to store Right Trigger to',
		description: TRIGGER_DESCRIPTION,
	},
]
