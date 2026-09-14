import { EventEmitter } from 'node:events'
import {
	createModuleLogger,
	type DetectionSurfaceInfo,
	type SurfacePluginDetection,
	type SurfacePluginDetectionEvents,
} from '@companion-surface/base'
import { sharedXInputDriver } from './driver.js'
import { XUSER_MAX_COUNT, type XInputDeviceInfo } from './types.js'
import { createEmptyState } from '../report.js'

const logger = createModuleLogger('XInput/Detection')
const SCAN_INTERVAL = 1000

export class XInputDetection
	extends EventEmitter<SurfacePluginDetectionEvents<XInputDeviceInfo>>
	implements SurfacePluginDetection<XInputDeviceInfo>
{
	readonly #connectedIndices = new Set<number>()
	#scanTimer: ReturnType<typeof setInterval> | undefined
	#running = false

	public start(): void {
		if (this.#running) return
		this.#running = true

		if (process.platform !== 'win32') return
		if (!sharedXInputDriver.isAvailable()) {
			logger.debug('XInput driver not available on this platform, skipping XInput detection')
			return
		}

		logger.info('Starting XInput device detection loop')
		this.triggerScan().catch((e) => {
			logger.error(`Error during initial XInput scan: ${e}`)
		})

		this.#scanTimer = setInterval(() => {
			this.triggerScan().catch((e) => {
				logger.error(`Error during periodic XInput scan: ${e}`)
			})
		}, SCAN_INTERVAL)
	}

	public stop(): void {
		this.#running = false
		if (this.#scanTimer !== undefined) {
			clearInterval(this.#scanTimer)
			this.#scanTimer = undefined
		}
		this.#connectedIndices.clear()
	}

	public async triggerScan(): Promise<void> {
		if (process.platform !== 'win32' || !sharedXInputDriver.isAvailable()) return

		const dummyState = createEmptyState()
		const newSurfaces: DetectionSurfaceInfo<XInputDeviceInfo>[] = []
		const removedHandles: string[] = []

		for (let i = 0; i < XUSER_MAX_COUNT; i++) {
			const isConnected = sharedXInputDriver.poll(i, dummyState)

			if (isConnected && !this.#connectedIndices.has(i)) {
				this.#connectedIndices.add(i)
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
			} else if (!isConnected && this.#connectedIndices.has(i)) {
				this.#connectedIndices.delete(i)
				logger.info(`XInput controller disconnected from Player ${i + 1}`)
				removedHandles.push(`xinput:${i}`)
			}
		}

		if (removedHandles.length > 0) {
			this.emit('surfacesRemoved', removedHandles)
		}
		if (newSurfaces.length > 0) {
			this.emit('surfacesAdded', newSurfaces)
		}
	}

	public rejectSurface(surfaceInfo: DetectionSurfaceInfo<XInputDeviceInfo>): void {
		logger.warn(`Rejected XInput surface: ${surfaceInfo.surfaceId}`)
		this.#connectedIndices.delete(surfaceInfo.pluginInfo.userIndex)
	}
}

export const xinputDetection = new XInputDetection()
