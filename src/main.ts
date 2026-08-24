import {
	createModuleLogger,
	type DiscoveredSurfaceInfo,
	type HIDDevice,
	type OpenSurfaceResult,
	type SurfaceContext,
	type SurfacePlugin,
} from '@companion-surface/base'
import { createHash } from 'node:crypto'
import { HIDAsync } from 'node-hid'
import { XboxControllerWrapper } from './instance.js'
import { createSurfaceSchema } from './surface-schema.js'
import { xboxControllerInfo } from './models.js'
import { findProduct } from './products.js'
import { configFields } from './config.js'
import { transferVariables } from './variables.js'
import { xinputDetection } from './xinput/detection.js'
import { XboxXInputSurfaceWrapper } from './xinput/instance.js'
import type { XInputDeviceInfo } from './xinput/types.js'

const logger = createModuleLogger('Plugin')

export type ControllerSurfaceInfo = HIDDevice | XInputDeviceInfo

const USAGE_PAGE_GENERIC_DESKTOP = 0x01
const USAGE_POINTER = 0x01
const USAGE_JOYSTICK = 0x04
const USAGE_GAMEPAD = 0x05
const USAGE_MULTI_AXIS = 0x08

/**
 * A controller can publish several HID collections. On macOS over Bluetooth, for example,
 * it publishes both a Gamepad (0x05) and a Pointer (0x01) collection under Generic Desktop.
 *
 * Skip non-controller collections (such as audio/headset endpoints), while accepting all
 * valid controller collections so device opening is not blocked.
 */
function isGamepadCollection(device: HIDDevice): boolean {
	// Filter out secondary interfaces (e.g. audio/headset endpoints on interface 1 or 2)
	if (device.interface !== undefined && device.interface > 0) return false

	if (device.usagePage === undefined || device.usage === undefined) return true
	if (device.usagePage !== USAGE_PAGE_GENERIC_DESKTOP) return false

	return (
		device.usage === USAGE_GAMEPAD ||
		device.usage === USAGE_JOYSTICK ||
		device.usage === USAGE_MULTI_AXIS ||
		device.usage === USAGE_POINTER
	)
}

/**
 * Normalize serial numbers that may be hex-encoded ASCII characters when read over USB
 * (e.g. "3039373030393533343837323235" -> "09700953487225").
 */
function normalizeSerialNumber(serialNumber: string): string {
	if (serialNumber.length >= 10 && serialNumber.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(serialNumber)) {
		try {
			const decoded = Buffer.from(serialNumber, 'hex').toString('utf8')
			if (/^[0-9A-Za-z_-]+$/.test(decoded)) {
				return decoded
			}
		} catch {
			// keep original
		}
	}
	return serialNumber
}

/**
 * Companion invents a serial number for devices that don't report one, by hashing the vendor and
 * product ids. That means two identical controllers get the same value, so it's no use as an id.
 * Recognise it by recreating it.
 */
function hasRealSerialNumber(device: HIDDevice): boolean {
	if (!device.serialNumber) return false

	const synthetic = createHash('sha1').update(`${device.vendorId}:${device.productId}`).digest('hex').slice(0, 20)

	return device.serialNumber !== synthetic
}

/**
 * Open the device, preferring an exclusive claim so that other software on the machine can't
 * also act on the button presses. Some platforms refuse an exclusive open when the OS is already
 * using the controller, so fall back rather than failing outright.
 */
async function openDevice(path: string): Promise<HIDAsync> {
	try {
		return await HIDAsync.open(path)
	} catch (e) {
		logger.debug(`Exclusive open failed (${e}), retrying without an exclusive claim`)
		return HIDAsync.open(path, { nonExclusive: true })
	}
}

const XboxControllerPlugin: SurfacePlugin<ControllerSurfaceInfo> = {
	detection: process.platform === 'win32' ? xinputDetection : undefined,

	init: async (): Promise<void> => {
		if (process.platform === 'win32') {
			xinputDetection.start()
		}
	},
	destroy: async (): Promise<void> => {
		if (process.platform === 'win32') {
			xinputDetection.stop()
		}
	},

	checkSupportsHidDevice: (device: HIDDevice): DiscoveredSurfaceInfo<ControllerSurfaceInfo> | null => {
		const product = findProduct(device.vendorId, device.productId)
		if (!product) return null

		if (!isGamepadCollection(device)) {
			logger.debug(`Skipping non-gamepad collection of ${product.name} (usage ${device.usage})`)
			return null
		}

		logger.debug(`Found ${product.name} at ${device.path}`)

		const hasSerial = hasRealSerialNumber(device)
		const serial = hasSerial ? normalizeSerialNumber(device.serialNumber) : product.modelId

		return {
			surfaceId: `xbox:${serial}`,
			// Without a real serial we can't tell two of the same controller apart, so let the host
			// disambiguate them
			surfaceIdIsNotUnique: !hasSerial,
			description: `${device.manufacturer ? `${device.manufacturer} ` : ''}${device.product || product.name}`.trim(),
			pluginInfo: device,
		}
	},

	openSurface: async (
		surfaceId: string,
		pluginInfo: ControllerSurfaceInfo,
		context: SurfaceContext,
	): Promise<OpenSurfaceResult> => {
		if ('transport' in pluginInfo && pluginInfo.transport === 'xinput') {
			logger.info(`Opening ${pluginInfo.name} (${surfaceId}) via XInput`)
			return {
				surface: new XboxXInputSurfaceWrapper(surfaceId, pluginInfo, xboxControllerInfo, context),
				registerProps: {
					brightness: false,
					surfaceLayout: createSurfaceSchema(xboxControllerInfo),
					pincodeMap: null,
					configFields,
					transferVariables,
					location: null,
				},
			}
		}

		const hidDevice = pluginInfo as HIDDevice
		const product = findProduct(hidDevice.vendorId, hidDevice.productId)
		const productName = hidDevice.product || product?.name || 'Xbox Controller'

		logger.debug(`Opening ${productName} (${surfaceId}) [transport: ${product?.transport ?? 'unknown'}]`)

		const device = await openDevice(hidDevice.path)
		try {
			return {
				surface: new XboxControllerWrapper(surfaceId, device, xboxControllerInfo, product, productName, context),
				registerProps: {
					brightness: false,
					surfaceLayout: createSurfaceSchema(xboxControllerInfo),
					pincodeMap: null,
					configFields,
					transferVariables,
					location: null,
				},
			}
		} catch (e) {
			await device.close().catch(() => {
				// Losing the original error to a close failure would not help anyone
			})
			throw e
		}
	},
}
export default XboxControllerPlugin
