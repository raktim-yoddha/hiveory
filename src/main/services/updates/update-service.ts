import type { UpdateStatus } from '@shared/domain'
import type { Logger } from '../../app/logger'
import type { Emit } from '../events'

/** Minimal surface of electron-updater's autoUpdater, so the service is testable. */
export interface Updater {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(): void
  on(event: string, listener: (...args: never[]) => void): unknown
}

const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

/**
 * Update checks against the project's GitHub releases (electron-updater).
 * Manual check is always available in installed builds; automatic checks run
 * on launch and every few hours when enabled. Development builds report
 * `unsupported` instead of pretending to check.
 */
export class UpdateService {
  private status: UpdateStatus
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly updater: Updater | null,
    private readonly log: Logger,
    private readonly emit: Emit
  ) {
    this.status = updater ? { state: 'idle' } : { state: 'unsupported', reason: 'Updates are available in installed builds.' }
    if (!updater) return
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = true
    updater.on('checking-for-update', () => this.set({ state: 'checking' }))
    updater.on('update-available', ((info: { version: string; releaseNotes?: unknown }) =>
      this.set({ state: 'available', version: info.version, notes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined })) as never)
    updater.on('update-not-available', () => this.set({ state: 'not-available', lastChecked: new Date().toISOString() }))
    updater.on('download-progress', ((p: { percent: number }) => {
      const version = this.status.state === 'available' || this.status.state === 'downloading' ? this.status.version : ''
      this.set({ state: 'downloading', version, percent: Math.round(p.percent) })
    }) as never)
    updater.on('update-downloaded', ((info: { version: string }) => this.set({ state: 'downloaded', version: info.version })) as never)
    updater.on('error', ((error: Error) => this.set({ state: 'error', message: error?.message ?? 'Update failed' })) as never)
  }

  current(): UpdateStatus {
    return this.status
  }

  async check(): Promise<UpdateStatus> {
    if (!this.updater) return this.status
    try {
      await this.updater.checkForUpdates()
    } catch (error) {
      this.log.warn('Update check failed', error)
      this.set({ state: 'error', message: error instanceof Error ? error.message : String(error) })
    }
    return this.status
  }

  async download(): Promise<UpdateStatus> {
    if (!this.updater || this.status.state !== 'available') return this.status
    try {
      await this.updater.downloadUpdate()
    } catch (error) {
      this.set({ state: 'error', message: error instanceof Error ? error.message : String(error) })
    }
    return this.status
  }

  install(): void {
    if (this.updater && this.status.state === 'downloaded') this.updater.quitAndInstall()
  }

  setAutoCheck(enabled: boolean): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (!enabled || !this.updater) return
    void this.check()
    this.timer = setInterval(() => void this.check(), AUTO_CHECK_INTERVAL_MS)
    this.timer.unref()
  }

  private set(status: UpdateStatus): void {
    this.status = status
    this.emit('updates.changed', status)
  }
}
