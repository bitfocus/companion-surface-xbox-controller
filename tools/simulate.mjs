// @ts-check
/**
 * Development aid: drive the surface with synthetic GIP frames and check what it emits.
 *
 *   yarn simulate
 *
 * The controller is often not to hand, and the parts most likely to break — thresholds,
 * hysteresis, rotary repeat rates, variable coalescing — don't need it. This exercises all of
 * them against a mock host context. Exits non-zero if anything fails.
 */
/* eslint-disable n/no-process-exit */

import { EventEmitter } from 'node:events'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const distDir = path.join(import.meta.dirname, '../dist')
const importDist = (file) => import(pathToFileURL(path.join(distDir, file)).href)

const { XboxControllerWrapper } = await importDist('instance.js')
const { xboxControllerInfo } = await importDist('models.js')

const STICK_MAX = 32767
const TRIGGER_MAX = 1023

const BUTTON = {
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

/** Build a GIP input frame (command 0x20) */
function frame({ buttons = 0, lt = 0, rt = 0, lx = 0, ly = 0, rx = 0, ry = 0 } = {}) {
	const buf = Buffer.alloc(19)
	buf[0] = 0x20
	buf[1] = 0x00
	buf[2] = 0x01
	buf[3] = 0x2c
	buf.writeUInt16LE(buttons, 4)
	buf.writeUInt16LE(lt, 6)
	buf.writeUInt16LE(rt, 8)
	buf.writeInt16LE(lx, 10)
	buf.writeInt16LE(ly, 12)
	buf.writeInt16LE(rx, 14)
	buf.writeInt16LE(ry, 16)
	return buf
}

/** Build a GIP guide-button frame (command 0x07), as captured from a Series X|S over USB */
function guideFrame(pressed) {
	return Buffer.from([0x07, 0x30, 0x19, 0x02, pressed ? 0x01 : 0x00, 0x5b])
}

/** Build a Bluetooth HID report (report id 0x01) */
function btFrame({
	buttons1 = 0,
	buttons2 = 0,
	buttons3 = 0,
	dpad = 0,
	lt = 0,
	rt = 0,
	lx = 0,
	ly = 0,
	rx = 0,
	ry = 0,
} = {}) {
	const buf = Buffer.alloc(17)
	buf[0] = 0x01
	const centre = 65535 / 2
	buf.writeUInt16LE(Math.round(centre + lx * centre), 1)
	buf.writeUInt16LE(Math.round(centre + ly * centre), 3)
	buf.writeUInt16LE(Math.round(centre + rx * centre), 5)
	buf.writeUInt16LE(Math.round(centre + ry * centre), 7)
	buf.writeUInt16LE(lt, 9)
	buf.writeUInt16LE(rt, 11)
	buf[13] = dpad
	buf[14] = buttons1
	buf[15] = buttons2
	buf[16] = buttons3
	return buf
}

let events = []
const context = {
	get isLocked() {
		return false
	},
	get capabilities() {
		return {}
	},
	disconnect: (e) => events.push(`disconnect(${e.message})`),
	keyDownById: (id) => events.push(`down ${id}`),
	keyUpById: (id) => events.push(`up ${id}`),
	keyDownUpById: (id) => events.push(`downup ${id}`),
	rotateLeftById: (id) => events.push(`rotL ${id}`),
	rotateRightById: (id) => events.push(`rotR ${id}`),
	changePage: () => {},
	sendVariableValue: (v, val) => events.push(`var ${v}=${val}`),
}

class FakeDevice extends EventEmitter {
	async close() {}
}

const device = new FakeDevice()
const surface = new XboxControllerWrapper('test', device, xboxControllerInfo, 'Test Pad', context)
await surface.updateConfig({ stickDeadzone: 15, pressThreshold: 50, rotaryMaxRate: 15 })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Settle first, so the one-off flush of every variable's starting value doesn't pollute the checks
device.emit('data', frame())
await sleep(80)

let failures = 0
async function check(label, report, expected, { settle = 0 } = {}) {
	events = []
	device.emit('data', report)
	if (settle) await sleep(settle)

	const actual = [...new Set(events)].sort()
	const want = [...expected].sort()
	const ok = JSON.stringify(actual) === JSON.stringify(want)
	if (!ok) failures++
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
	if (!ok) {
		console.log(`        expected: ${JSON.stringify(want)}`)
		console.log(`        actual:   ${JSON.stringify(actual)}`)
	}
}

console.log('--- face buttons, bumpers (row 0) ---')
await check('neutral produces nothing', frame(), [])
await check('A', frame({ buttons: BUTTON.a }), ['down 0/0'])
await check('A held does not repeat', frame({ buttons: BUTTON.a }), [])
await check('A released', frame(), ['up 0/0'])
await check('B', frame({ buttons: BUTTON.b }), ['down 0/1'])
await check('B released', frame(), ['up 0/1'])
await check('X and Y together', frame({ buttons: BUTTON.x | BUTTON.y }), ['down 0/2', 'down 0/3'])
await check('X and Y released', frame(), ['up 0/2', 'up 0/3'])
await check('LB and RB', frame({ buttons: BUTTON.lb | BUTTON.rb }), ['down 0/4', 'down 0/5'])
await check('LB and RB released', frame(), ['up 0/4', 'up 0/5'])

console.log('\n--- d-pad and system buttons (row 1) ---')
await check('D-Up', frame({ buttons: BUTTON.dpadUp }), ['down 1/0'])
await check('D-Up released', frame(), ['up 1/0'])
await check('D-Down', frame({ buttons: BUTTON.dpadDown }), ['down 1/1'])
await check('D-Left', frame({ buttons: BUTTON.dpadLeft }), ['up 1/1', 'down 1/2'])
await check('D-Right', frame({ buttons: BUTTON.dpadRight }), ['up 1/2', 'down 1/3'])
await check('diagonal Up+Right', frame({ buttons: BUTTON.dpadUp | BUTTON.dpadRight }), ['down 1/0'])
await check('d-pad released', frame(), ['up 1/0', 'up 1/3'])
await check('View', frame({ buttons: BUTTON.view }), ['down 1/4'])
await check('Menu', frame({ buttons: BUTTON.menu }), ['up 1/4', 'down 1/5'])
await check('Menu released', frame(), ['up 1/5'])
await check('Xbox button (guide frame)', guideFrame(true), ['down 1/6'])
await check('Xbox button released', guideFrame(false), ['up 1/6'])

console.log('\n--- stick clicks ---')
await check('both stick clicks', frame({ buttons: BUTTON.leftStickClick | BUTTON.rightStickClick }), [
	'down 2/4',
	'down 3/4',
])
await check('stick clicks released', frame(), ['up 2/4', 'up 3/4'])

console.log('\n--- triggers ---')
await check(
	'LT at 30% stays released',
	frame({ lt: Math.round(TRIGGER_MAX * 0.3) }),
	['var leftTriggerVariable=0.177'],
	{
		settle: 80,
	},
)
await check('LT full presses', frame({ lt: TRIGGER_MAX }), ['down 0/6', 'var leftTriggerVariable=1'], { settle: 80 })
await check('LT released', frame(), ['up 0/6', 'var leftTriggerVariable=0'], { settle: 80 })
await check('RT full presses', frame({ rt: TRIGGER_MAX }), ['down 0/7', 'var rightTriggerVariable=1'], { settle: 80 })
await check('RT released', frame(), ['up 0/7', 'var rightTriggerVariable=0'], { settle: 80 })

console.log('\n--- sticks as direction buttons and rotaries ---')
await check('left stick full right', frame({ lx: STICK_MAX }), ['down 2/3', 'rotR 2/5', 'var leftStickXVariable=1'], {
	settle: 80,
})
await check('left stick centred', frame(), ['up 2/3', 'var leftStickXVariable=0'], { settle: 80 })
await check('left stick full left', frame({ lx: -STICK_MAX }), ['down 2/2', 'rotL 2/5', 'var leftStickXVariable=-1'], {
	settle: 80,
})
await check('left stick centred', frame(), ['up 2/2', 'var leftStickXVariable=0'], { settle: 80 })
await check('left stick full up', frame({ ly: STICK_MAX }), ['down 2/0', 'rotR 2/6', 'var leftStickYVariable=1'], {
	settle: 80,
})
await check('left stick centred', frame(), ['up 2/0', 'var leftStickYVariable=0'], { settle: 80 })
await check('left stick full down', frame({ ly: -STICK_MAX }), ['down 2/1', 'rotL 2/6', 'var leftStickYVariable=-1'], {
	settle: 80,
})
await check('left stick centred', frame(), ['up 2/1', 'var leftStickYVariable=0'], { settle: 80 })
await check('right stick full right', frame({ rx: STICK_MAX }), ['down 3/3', 'rotR 3/5', 'var rightStickXVariable=1'], {
	settle: 80,
})
await check('right stick centred', frame(), ['up 3/3', 'var rightStickXVariable=0'], { settle: 80 })
await check(
	'right stick full down',
	frame({ ry: -STICK_MAX }),
	['down 3/1', 'rotL 3/6', 'var rightStickYVariable=-1'],
	{
		settle: 80,
	},
)
await check('right stick centred', frame(), ['up 3/1', 'var rightStickYVariable=0'], { settle: 80 })

console.log('\n--- deadzone ---')
await check('stick inside deadzone is silent', frame({ lx: Math.round(STICK_MAX * 0.1) }), [], { settle: 80 })

console.log('\n--- rotary repeat rate ---')
events = []
device.emit('data', frame({ lx: STICK_MAX }))
await sleep(1000)
const fastRotates = events.filter((e) => e === 'rotR 2/5').length
device.emit('data', frame())
await sleep(80)
const fastOk = fastRotates >= 13 && fastRotates <= 18
if (!fastOk) failures++
console.log(`${fastOk ? 'PASS' : 'FAIL'}  full deflection repeats ~15/sec (got ${fastRotates})`)

events = []
device.emit('data', frame({ lx: Math.round(STICK_MAX * 0.3) }))
await sleep(1000)
const slowRotates = events.filter((e) => e === 'rotR 2/5').length
device.emit('data', frame())
await sleep(80)
const slowOk = slowRotates >= 2 && slowRotates < fastRotates
if (!slowOk) failures++
console.log(`${slowOk ? 'PASS' : 'FAIL'}  partial deflection repeats slower (got ${slowRotates} vs ${fastRotates})`)

console.log('\n--- hysteresis ---')
await check(
	'push to 60% presses',
	frame({ lx: Math.round(STICK_MAX * 0.6) }),
	['down 2/3', 'rotR 2/5', 'var leftStickXVariable=0.529'],
	{ settle: 80 },
)
events = []
device.emit('data', frame({ lx: Math.round(STICK_MAX * 0.45) }))
await sleep(80)
const stayedDown = !events.some((e) => e === 'up 2/3')
if (!stayedDown) failures++
console.log(`${stayedDown ? 'PASS' : 'FAIL'}  backing off slightly keeps it pressed`)
device.emit('data', frame())
await sleep(80)

console.log('\n--- bluetooth reports (report id 0x01) ---')
// Note: the Bluetooth layout has not been confirmed against hardware, so these only check that the
// second parse path is wired up consistently with what it claims to decode.
await check('BT neutral is silent', btFrame(), [])
await check('BT A button', btFrame({ buttons1: 0x01 }), ['down 0/0'])
await check('BT A released', btFrame(), ['up 0/0'])
await check('BT hat up', btFrame({ dpad: 1 }), ['down 1/0'])
await check('BT hat down-left', btFrame({ dpad: 6 }), ['up 1/0', 'down 1/1', 'down 1/2'])
await check('BT hat centred', btFrame(), ['up 1/1', 'up 1/2'])
await check('BT Share button', btFrame({ buttons3: 0x01 }), ['down 1/7'])
await check('BT Share released', btFrame(), ['up 1/7'])
await check('BT stick up is positive', btFrame({ ly: -1 }), ['down 2/0', 'rotR 2/6', 'var leftStickYVariable=1'], {
	settle: 80,
})
await check('BT stick centred', btFrame(), ['up 2/0', 'var leftStickYVariable=0'], { settle: 80 })

console.log('\n--- frames we should ignore ---')
await check('short frame ignored', Buffer.alloc(4), [])
await check('unknown command byte ignored', Buffer.concat([Buffer.from([0x99]), Buffer.alloc(18)]), [])

console.log('\n--- cleanup ---')
await surface.close()
events = []
device.emit('data', frame({ buttons: BUTTON.a }))
await sleep(80)
const quietAfterClose = events.length === 0
if (!quietAfterClose) failures++
console.log(`${quietAfterClose ? 'PASS' : 'FAIL'}  no events after close (got ${JSON.stringify(events)})`)

console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILURE(S)'}`)
process.exit(failures === 0 ? 0 : 1)
