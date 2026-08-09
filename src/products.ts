/**
 * The controllers we know how to talk to.
 *
 * Xbox controllers speak two quite different protocols depending on how they are attached:
 *
 * - Over Bluetooth they are ordinary HID gamepads, and every modern OS exposes them as such.
 * - Over USB they speak GIP (Xbox One and later) or XUSB (Xbox 360), neither of which is HID.
 *   Whether we can see them therefore depends on the OS shipping a driver that republishes
 *   them as HID. macOS and Windows both do for the Xbox One family and later; on Linux the
 *   `xpad` driver claims the device and does not, so USB there needs `xpad` blacklisting.
 *
 * Both transports of a given controller are listed, because the pid differs between them and
 * we want to match either.
 */

export const VENDOR_ID_MICROSOFT = 0x045e

export enum ControllerModelId {
	XboxSeries = 'xbox-series',
	XboxOne = 'xbox-one',
	XboxElite = 'xbox-elite',
	XboxAdaptive = 'xbox-adaptive',
}

export interface ControllerProduct {
	vendorId: number
	productId: number
	modelId: ControllerModelId
	name: string
}

export const PRODUCTS: ControllerProduct[] = [
	// Xbox Series X|S — the primary target
	{
		vendorId: VENDOR_ID_MICROSOFT,
		productId: 0x0b12,
		modelId: ControllerModelId.XboxSeries,
		name: 'Xbox Wireless Controller',
	},
	{
		vendorId: VENDOR_ID_MICROSOFT,
		productId: 0x0b13,
		modelId: ControllerModelId.XboxSeries,
		name: 'Xbox Wireless Controller',
	},
	{
		vendorId: VENDOR_ID_MICROSOFT,
		productId: 0x0b20,
		modelId: ControllerModelId.XboxSeries,
		name: 'Xbox Wireless Controller',
	},
	{
		vendorId: VENDOR_ID_MICROSOFT,
		productId: 0x0b21,
		modelId: ControllerModelId.XboxSeries,
		name: 'Xbox Wireless Controller',
	},

	// Xbox One family. Same report layout as the Series pads, so they come along for free.
	{
		vendorId: VENDOR_ID_MICROSOFT,
		productId: 0x02e0,
		modelId: ControllerModelId.XboxOne,
		name: 'Xbox One S Controller',
	},
	{
		vendorId: VENDOR_ID_MICROSOFT,
		productId: 0x02ea,
		modelId: ControllerModelId.XboxOne,
		name: 'Xbox One S Controller',
	},
	{
		vendorId: VENDOR_ID_MICROSOFT,
		productId: 0x02fd,
		modelId: ControllerModelId.XboxOne,
		name: 'Xbox One S Controller',
	},

	// Elite Series 2
	{
		vendorId: VENDOR_ID_MICROSOFT,
		productId: 0x0b00,
		modelId: ControllerModelId.XboxElite,
		name: 'Xbox Elite Wireless Controller Series 2',
	},
	{
		vendorId: VENDOR_ID_MICROSOFT,
		productId: 0x0b05,
		modelId: ControllerModelId.XboxElite,
		name: 'Xbox Elite Wireless Controller Series 2',
	},
	{
		vendorId: VENDOR_ID_MICROSOFT,
		productId: 0x0b22,
		modelId: ControllerModelId.XboxElite,
		name: 'Xbox Elite Wireless Controller Series 2',
	},

	// Adaptive Controller
	{
		vendorId: VENDOR_ID_MICROSOFT,
		productId: 0x0b0a,
		modelId: ControllerModelId.XboxAdaptive,
		name: 'Xbox Adaptive Controller',
	},
	{
		vendorId: VENDOR_ID_MICROSOFT,
		productId: 0x0b0c,
		modelId: ControllerModelId.XboxAdaptive,
		name: 'Xbox Adaptive Controller',
	},
]

export function findProduct(vendorId: number, productId: number): ControllerProduct | undefined {
	return PRODUCTS.find((product) => product.vendorId === vendorId && product.productId === productId)
}
