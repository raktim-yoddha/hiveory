import { app, Menu, nativeImage, Tray, type BrowserWindow } from 'electron'
import appIcon from '@resources/icon.png?asset'
import devIcon from '@resources/icon-dev.png?asset'

/**
 * Keeps Hiveory alive after its window closes (Settings › Agents › "Keep agents
 * running in the background"): the window hides, a tray icon stays, and every
 * agent keeps working. The tray reopens the window or quits for real.
 */
export class BackgroundTray {
  private tray: Tray | null = null
  private told = false

  constructor(
    private readonly window: () => BrowserWindow | null,
    private readonly runningAgents: () => number,
    private readonly quit: () => void
  ) {}

  /** Hides the window into the tray. The first time, says so (agents are still working). */
  hide(): void {
    const w = this.window()
    if (!w) return
    w.hide()
    this.ensure()
    this.refresh()
    if (!this.told && process.platform === 'win32') {
      this.told = true
      const n = this.runningAgents()
      this.tray?.displayBalloon({
        iconType: 'info',
        title: 'Hiveory is still running',
        content: `${n ? `${n} ${n === 1 ? 'agent keeps' : 'agents keep'} working.` : 'Your agents keep working.'} Open Hiveory from here; Quit stops them.`
      })
    }
  }

  show(): void {
    const w = this.window()
    if (!w) return
    if (w.isMinimized()) w.restore()
    w.show()
    w.focus()
  }

  destroy(): void {
    this.tray?.destroy()
    this.tray = null
  }

  private ensure(): void {
    if (this.tray) return
    const image = nativeImage.createFromPath(app.isPackaged ? appIcon : devIcon).resize({ width: 16, height: 16 })
    this.tray = new Tray(image)
    this.tray.on('click', () => this.show())
    // The agent count is read when the menu opens, so it is never stale.
    this.tray.on('right-click', () => this.refresh())
  }

  private refresh(): void {
    if (!this.tray) return
    const n = this.runningAgents()
    const running = n ? `${n} ${n === 1 ? 'agent' : 'agents'} running` : 'No agents running'
    this.tray.setToolTip(`Hiveory — ${running}`)
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open Hiveory', click: () => this.show() },
        { label: running, enabled: false },
        { type: 'separator' },
        { label: 'Quit Hiveory (stops agents)', click: () => this.quit() }
      ])
    )
  }
}
