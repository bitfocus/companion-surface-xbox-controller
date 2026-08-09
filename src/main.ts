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

const logger = createModuleLogger('Plugin')

const USAGE_PAGE_GENERIC_DESKTOP = 0x01
const USAGE_JOYSTICK = 0x04
const USAGE_GAMEPAD = 0x05
const USAGE_MULTI_AXIS = 0x08

/**
 * A controller can publish several HID collections, only one of which carries the gamepad
 * reports. Skip the others, otherwise we'd open the same controller more than once.
 *
 * Not every platform reports usage information. When it's missing we have to accept the device,
 * since the product id has already told us it is a controller we support.
 */
function isGamepadCollection(device: HIDDevice): boolean {
	if (device.usagePage === undefined || device.usage === undefined) return true
	if (device.usagePage !== USAGE_PAGE_GENERIC_DESKTOP) return false

	return device.usage === USAGE_GAMEPAD || device.usage === USAGE_JOYSTICK || device.usage === USAGE_MULTI_AXIS
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

const XboxControllerPlugin: SurfacePlugin<HIDDevice> = {
	init: async (): Promise<void> => {
		// Not used
	},
	destroy: async (): Promise<void> => {
		// Not used
	},

	checkSupportsHidDevice: (device: HIDDevice): DiscoveredSurfaceInfo<HIDDevice> | null => {
		const product = findProduct(device.vendorId, device.productId)
		if (!product) return null

		if (!isGamepadCollection(device)) {
			logger.debug(`Skipping non-gamepad collection of ${product.name} (usage ${device.usage})`)
			return null
		}

		logger.debug(`Found ${product.name} at ${device.path}`)

		const hasSerial = hasRealSerialNumber(device)

		return {
			surfaceId: hasSerial ? `xbox:${device.serialNumber}` : `xbox:${product.modelId}`,
			// Without a real serial we can't tell two of the same controller apart, so let the host
			// disambiguate them
			surfaceIdIsNotUnique: !hasSerial,
			description: `${device.manufacturer ? `${device.manufacturer} ` : ''}${device.product || product.name}`.trim(),
			pluginInfo: device,
		}
	},

	openSurface: async (
		surfaceId: string,
		pluginInfo: HIDDevice,
		context: SurfaceContext,
	): Promise<OpenSurfaceResult> => {
		const product = findProduct(pluginInfo.vendorId, pluginInfo.productId)
		const productName = pluginInfo.product || product?.name || 'Xbox Controller'

		logger.debug(`Opening ${productName} (${surfaceId})`)

		const device = await openDevice(pluginInfo.path)
		try {
			return {
				surface: new XboxControllerWrapper(surfaceId, device, xboxControllerInfo, productName, context),
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
