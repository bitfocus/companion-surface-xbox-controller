// @ts-check
/**
 * Development aid: find gamepad-like HID devices, open them, and dump their input reports.
 *
 * Run with the controller connected:
 *   node tools/probe-hid.mjs            # list candidates
 *   node tools/probe-hid.mjs --open     # list, then open the best candidate and dump reports
 *   node tools/probe-hid.mjs --open --all   # open every candidate at once
 *
 * Bytes that changed since the previous report are highlighted, which is what makes it
 * practical to work out which byte/bit belongs to which button.
 */
// This is an interactive command line tool, so exiting with a status code is the point
/* eslint-disable n/no-process-exit */

import HID from 'node-hid'

const args = process.argv.slice(2)
const doOpen = args.includes('--open')
const openAll = args.includes('--all')

const USAGE_PAGE_GENERIC_DESKTOP = 0x01
const USAGE_JOYSTICK = 0x04
const USAGE_GAMEPAD = 0x05
const USAGE_MULTIAXIS = 0x08

const hex = (n, w = 2) => '0x' + (n ?? 0).toString(16).padStart(w, '0')

function isGamepadLike(device) {
	if (
		device.usagePage === USAGE_PAGE_GENERIC_DESKTOP &&
		(device.usage === USAGE_JOYSTICK || device.usage === USAGE_GAMEPAD || device.usage === USAGE_MULTIAXIS)
	) {
		return true
	}
	// Microsoft, in case the usage page isn't reported (happens on some platforms/transports)
	if (device.vendorId === 0x045e) return true
	// A product name is often the only hint we get
	return /x-?box|gamepad|controller/i.test(`${device.product ?? ''} ${device.manufacturer ?? ''}`)
}

const all = HID.devices()
const candidates = all.filter(isGamepadLike)

console.log(
	`node-hid ${HID.getHidapiVersion?.() ?? ''} — ${all.length} HID devices total, ${candidates.length} gamepad-like\n`,
)

if (candidates.length === 0) {
	console.log('No gamepad-like HID device found.')
	console.log('If the controller is plugged in and powered on, the OS is not exposing it as a HID device.')
	console.log('\nFull device list, for reference:')
	for (const d of all) {
		console.log(`  ${hex(d.vendorId, 4)}:${hex(d.productId, 4)} ${d.manufacturer ?? '?'} / ${d.product ?? '?'}`)
	}
	process.exit(1)
}

for (const [i, d] of candidates.entries()) {
	console.log(`[${i}] ${hex(d.vendorId, 4)}:${hex(d.productId, 4)}  (vid=${d.vendorId} pid=${d.productId})`)
	console.log(`    manufacturer : ${d.manufacturer ?? '(none)'}`)
	console.log(`    product      : ${d.product ?? '(none)'}`)
	console.log(`    serialNumber : ${d.serialNumber ?? '(none)'}`)
	console.log(`    usagePage    : ${hex(d.usagePage)}   usage: ${hex(d.usage)}`)
	console.log(`    interface    : ${d.interface}   release: ${d.release}`)
	console.log(`    path         : ${d.path}`)
	console.log()
}

if (!doOpen) {
	console.log('Re-run with --open to dump input reports.')
	process.exit(0)
}

const toOpen = openAll ? candidates : [candidates[0]]

for (const info of toOpen) {
	if (!info.path) {
		console.log(`Cannot open ${info.product} — no path`)
		continue
	}

	let device
	try {
		device = new HID.HID(info.path)
	} catch (e) {
		console.log(`FAILED to open [${hex(info.vendorId, 4)}:${hex(info.productId, 4)}] ${info.product}: ${e}`)
		continue
	}

	console.log(
		`OPENED ${hex(info.vendorId, 4)}:${hex(info.productId, 4)} ${info.product ?? ''} — press buttons and move sticks (ctrl-c to stop)\n`,
	)

	let previous = null
	let count = 0

	device.on('data', (data) => {
		count++
		const parts = []
		for (let i = 0; i < data.length; i++) {
			const byte = data[i].toString(16).padStart(2, '0')
			const changed = previous && previous[i] !== data[i]
			// bold+inverse the bytes that moved, so the interesting ones stand out
			parts.push(changed ? `\x1b[1;7m${byte}\x1b[0m` : byte)
		}
		const idx = String(count).padStart(5, ' ')
		console.log(`${idx} len=${String(data.length).padStart(2, ' ')} | ${parts.join(' ')}`)
		previous = Buffer.from(data)
	})

	device.on('error', (err) => {
		console.log(`ERROR from ${info.product}: ${err}`)
	})

	process.on('SIGINT', () => {
		try {
			device.close()
		} catch {
			// already gone
		}
		process.exit(0)
	})
}
