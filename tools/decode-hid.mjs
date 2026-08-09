// @ts-check
/**
 * Development aid: open the controller and print each frame decoded through src/report.ts.
 *
 *   yarn build && node tools/decode-hid.mjs
 *
 * Where probe-hid.mjs shows raw bytes, this shows what the module actually makes of them, which is
 * what you want when checking that a button is mapped to the right name.
 */
/* eslint-disable n/no-process-exit */

import path from 'node:path'
import { pathToFileURL } from 'node:url'
import HID from 'node-hid'

const distDir = path.join(import.meta.dirname, '../dist')
const importDist = (file) => import(pathToFileURL(path.join(distDir, file)).href)

const { createEmptyState, parseInputReport } = await importDist('report.js')
const { findProduct } = await importDist('products.js')

const candidate = HID.devices().find((d) => d.path && findProduct(d.vendorId, d.productId))
if (!candidate?.path) {
	console.log('No supported controller found. Is it connected and powered on?')
	process.exit(1)
}

console.log(`Opening ${candidate.manufacturer ?? ''} ${candidate.product ?? ''} — press things (ctrl-c to stop)\n`)

const device = new HID.HID(candidate.path)
const state = createEmptyState()

/** @type {string} */
let lastLine = ''
let unrecognised = 0

device.on('data', (data) => {
	if (!parseInputReport(data, state)) {
		unrecognised++
		console.log(`unrecognised frame (${data.length} bytes, cmd 0x${data[0]?.toString(16)}): ${data.toString('hex')}`)
		return
	}

	const pressed = Object.entries(state.buttons)
		.filter(([, isDown]) => isDown)
		.map(([name]) => name)

	const axes = Object.entries(state.axes)
		.filter(([, value]) => Math.abs(value) > 0.08)
		.map(([name, value]) => `${name}=${value.toFixed(2)}`)

	// Only print when something meaningful changed, otherwise the stream is unreadable
	const line = `buttons[${pressed.join(' ')}] axes[${axes.join(' ')}]`
	if (line === lastLine) return
	lastLine = line

	console.log(line)
})

device.on('error', (err) => console.log(`ERROR: ${err}`))

process.on('SIGINT', () => {
	console.log(`\n${unrecognised} unrecognised frames`)
	try {
		device.close()
	} catch {
		// already gone
	}
	process.exit(0)
})
