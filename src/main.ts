import {
	createModuleLogger,
	type DiscoveredSurfaceInfo,
	type HIDDevice,
	type OpenSurfaceResult,
	type SurfaceContext,
	type SurfacePlugin,
} from '@companion-surface/base'
import { HIDAsync } from 'node-hid'
import { XboxControllerWrapper } from './instance.js'
import { createSurfaceSchema } from './surface-schema.js'
import { xboxControllerInfo } from './models.js'
import { findProduct } from './products.js'
import { configFields } from './config.js'
import { transferVariables } from './variables.js'
import { checkSupportsHidDevice } from './hid.js'
import { xinputDetection } from './xinput/detection.js'
import { XboxXInputSurfaceWrapper } from './xinput/instance.js'
import type { XInputDeviceInfo } from './xinput/types.js'

const logger = createModuleLogger('Plugin')

export type ControllerSurfaceInfo = HIDDevice | XInputDeviceInfo

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
		return checkSupportsHidDevice(device)
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
