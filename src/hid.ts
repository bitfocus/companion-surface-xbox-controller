import { createHash } from 'node:crypto'
import type { DiscoveredSurfaceInfo, HIDDevice } from '@companion-surface/base'
import { createModuleLogger } from '@companion-surface/base'
import { findProduct } from './products.js'

const logger = createModuleLogger('HID')

const USAGE_PAGE_GENERIC_DESKTOP = 0x01
const USAGE_POINTER = 0x01
const USAGE_JOYSTICK = 0x04
const USAGE_GAMEPAD = 0x05
const USAGE_MULTI_AXIS = 0x08

export function isGamepadCollection(device: HIDDevice): boolean {
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

export function normalizeSerialNumber(serialNumber: string): string {
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

export function hasRealSerialNumber(device: HIDDevice): boolean {
	if (!device.serialNumber) return false
	const synthetic = createHash('sha1').update(`${device.vendorId}:${device.productId}`).digest('hex').slice(0, 20)
	return device.serialNumber !== synthetic
}

export function checkSupportsHidDevice(device: HIDDevice): DiscoveredSurfaceInfo<HIDDevice> | null {
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
		surfaceIdIsNotUnique: !hasSerial,
		description: `${device.manufacturer ? `${device.manufacturer} ` : ''}${device.product || product.name}`.trim(),
		pluginInfo: device,
	}
}
