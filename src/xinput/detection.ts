import { EventEmitter } from 'node:events'
import HID from 'node-hid'
import {
	createModuleLogger,
	type DetectionSurfaceInfo,
	type HIDDevice,
	type SurfacePluginDetection,
	type SurfacePluginDetectionEvents,
} from '@companion-surface/base'
import { sharedXInputDriver } from './driver.js'
import { XUSER_MAX_COUNT, type XInputDeviceInfo } from './types.js'
import { createEmptyState } from '../report.js'
import { checkSupportsHidDevice } from '../hid.js'

const logger = createModuleLogger('XInput/Detection')
const SCAN_INTERVAL = 1000

export type AnySurfaceInfo = HIDDevice | XInputDeviceInfo

export class XInputDetection
	extends EventEmitter<SurfacePluginDetectionEvents<AnySurfaceInfo>>
	implements SurfacePluginDetection<AnySurfaceInfo>
{
	readonly #connectedXInputIndices = new Set<number>()
	readonly #connectedHidPaths = new Set<string>()
	#scanTimer: ReturnType<typeof setInterval> | undefined
	#running = false

	public start(): void {
		if (this.#running) return
		this.#running = true

		logger.info('Starting device detection loop')
		this.triggerScan().catch((e) => {
			logger.error(`Error during initial scan: ${e}`)
		})

		this.#scanTimer = setInterval(() => {
			this.triggerScan().catch((e) => {
				logger.error(`Error during periodic scan: ${e}`)
			})
		}, SCAN_INTERVAL)
	}

	public stop(): void {
		this.#running = false
		if (this.#scanTimer !== undefined) {
			clearInterval(this.#scanTimer)
			this.#scanTimer = undefined
		}
		this.#connectedXInputIndices.clear()
		this.#connectedHidPaths.clear()
	}

	public async triggerScan(): Promise<void> {
		const newSurfaces: DetectionSurfaceInfo<AnySurfaceInfo>[] = []
		const removedHandles: string[] = []

		// 1. Scan XInput controllers (Windows USB / Adapter)
		if (process.platform === 'win32' && sharedXInputDriver.isAvailable()) {
			const dummyState = createEmptyState()
			for (let i = 0; i < XUSER_MAX_COUNT; i++) {
				const isConnected = sharedXInputDriver.poll(i, dummyState)

				if (isConnected && !this.#connectedXInputIndices.has(i)) {
					this.#connectedXInputIndices.add(i)
					const playerNum = i + 1
					logger.info(`Detected XInput controller on Player ${playerNum}`)

					newSurfaces.push({
						surfaceId: `xbox:xinput-${playerNum}`,
						deviceHandle: `xinput:${i}`,
						description: `Xbox Controller (XInput Player ${playerNum})`,
						surfaceIdIsNotUnique: false,
						pluginInfo: {
							transport: 'xinput',
							userIndex: i,
							name: `Xbox Controller (XInput Player ${playerNum})`,
						},
					})
				} else if (!isConnected && this.#connectedXInputIndices.has(i)) {
					this.#connectedXInputIndices.delete(i)
					logger.info(`XInput controller disconnected from Player ${i + 1}`)
					removedHandles.push(`xinput:${i}`)
				}
			}
		}

		// 2. Scan HID devices (Bluetooth / Direct HID)
		try {
			const currentHidPaths = new Set<string>()
			const hidDevices = (await HID.devicesAsync()) as HIDDevice[]

			for (const dev of hidDevices) {
				if (!dev.path) continue
				const supported = checkSupportsHidDevice(dev)
				if (supported) {
					currentHidPaths.add(dev.path)
					if (!this.#connectedHidPaths.has(dev.path)) {
						this.#connectedHidPaths.add(dev.path)
						logger.info(`Detected HID surface: ${supported.description} at ${dev.path}`)
						newSurfaces.push({
							...supported,
							deviceHandle: dev.path,
						})
					}
				}
			}

			// Check for removed HID devices
			for (const path of this.#connectedHidPaths) {
				if (!currentHidPaths.has(path)) {
					this.#connectedHidPaths.delete(path)
					logger.info(`HID surface disconnected at ${path}`)
					removedHandles.push(path)
				}
			}
		} catch (e) {
			logger.debug(`HID device scan error: ${e}`)
		}

		if (removedHandles.length > 0) {
			this.emit('surfacesRemoved', removedHandles)
		}
		if (newSurfaces.length > 0) {
			this.emit('surfacesAdded', newSurfaces)
		}
	}

	public rejectSurface(surfaceInfo: DetectionSurfaceInfo<AnySurfaceInfo>): void {
		logger.warn(`Rejected surface: ${surfaceInfo.surfaceId}`)
		if ('transport' in surfaceInfo.pluginInfo && surfaceInfo.pluginInfo.transport === 'xinput') {
			this.#connectedXInputIndices.delete(surfaceInfo.pluginInfo.userIndex)
		} else if ('path' in surfaceInfo.pluginInfo && surfaceInfo.pluginInfo.path) {
			this.#connectedHidPaths.delete(surfaceInfo.pluginInfo.path)
		}
	}
}

export const xinputDetection = new XInputDetection()
