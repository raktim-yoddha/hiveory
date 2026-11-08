import { app, BrowserWindow, Menu, nativeImage, Notification, type NativeImage } from 'electron'
import { linkFromArgv, LINK_SCHEME, openLink, parseHiveoryLink, type HiveoryLink } from '@shared/domain/links'
import type { Handlers } from '../ipc/router'
import type { Logger } from './logger'

/** A notification nobody clicks or closes settles as "not clicked" after this. */
const NOTIFY_TIMEOUT_MS = 15 * 60_000

type Send = (event: 'app.link', payload: HiveoryLink) => void
export type NativeHandlers = Pick<Handlers, 'app.notify' | 'app.setAttention' | 'app.pendingLink' | 'app.setRecent'>

/** A small filled circle for the Windows taskbar overlay (no image file to ship). */
const dot = (size = 16, rgb: [number, number, number] = [214, 92, 70]): NativeImage => {
  const pixels = Buffer.alloc(size * size * 4)
  const r = size / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - r, y + 0.5 - r)
      const alpha = Math.max(0, Math.min(1, r - d)) // anti-aliased edge
      const i = (y * size + x) * 4
      // BGRA, premultiplied.
      pixels[i] = Math.round(rgb[2] * alpha)
      pixels[i + 1] = Math.round(rgb[1] * alpha)
      pixels[i + 2] = Math.round(rgb[0] * alpha)
      pixels[i + 3] = Math.round(255 * alpha)
    }
  }
  return nativeImage.createFromBitmap(pixels, { width: size, height: size })
}

/**
 * What makes Hiveory behave like a native app (ADR 0061), answered by the window's own machine in
 * both local and client mode: desktop notifications, the taskbar/dock badge and flash, hiveory://
 * links (registered with the system in installed builds) and the jump list / dock menu of recent
 * Workspaces.
 */
export class NativeShell {
  /** A link that arrived before the window could take it. */
  private pending: HiveoryLink | null
  /** The window has asked for the pending link: later links go to it directly. */
  private windowReady = false
  private waiting = 0
  private overlay: NativeImage | null = null

  constructor(
    private readonly send: Send,
    private readonly log: Logger
  ) {
    this.pending = linkFromArgv(process.argv)
  }

  private window(): BrowserWindow | undefined {
    return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
  }

  private bringForward(): void {
    const w = this.window()
    if (!w) return
    if (w.isMinimized()) w.restore()
    w.show()
    w.focus()
  }

  /** Installed builds own hiveory:// (development builds and test runs never take it from them). */
  register(): void {
    if (app.isPackaged && !app.isDefaultProtocolClient(LINK_SCHEME)) {
      if (!app.setAsDefaultProtocolClient(LINK_SCHEME)) this.log.warn('Could not register hiveory:// links')
    }
    // macOS hands links to the running app.
    app.on('open-url', (event, url) => {
      event.preventDefault()
      this.open(parseHiveoryLink(url))
    })
  }

  /** Windows and Linux start a second instance with the link; it lands here. */
  fromArgv(argv: readonly string[]): void {
    this.open(linkFromArgv(argv))
  }

  open(link: HiveoryLink | null): void {
    if (!link) return
    this.bringForward()
    if (this.windowReady) this.send('app.link', link)
    else this.pending = link
  }

  notify(input: { title: string; body: string; tag?: string }): Promise<{ clicked: boolean }> {
    if (!Notification.isSupported()) return Promise.resolve({ clicked: false })
    return new Promise((resolve) => {
      const shown = new Notification({ title: input.title, body: input.body })
      let done = false
      const settle = (clicked: boolean): void => {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve({ clicked })
      }
      const timer = setTimeout(() => settle(false), NOTIFY_TIMEOUT_MS)
      shown.on('click', () => {
        this.bringForward()
        settle(true)
      })
      shown.on('close', () => settle(false))
      shown.on('failed', () => settle(false))
      shown.show()
    })
  }

  /** The count of agents that need you, on the taskbar or dock; a new one flashes it while Hiveory is not in front. */
  setAttention(waiting: number): void {
    const more = waiting > this.waiting
    this.waiting = waiting
    if (process.platform === 'darwin' || process.platform === 'linux') app.setBadgeCount(waiting)
    const w = this.window()
    if (!w) return
    if (process.platform === 'win32') {
      this.overlay ??= dot()
      w.setOverlayIcon(waiting ? this.overlay : null, waiting ? `${waiting} ${waiting === 1 ? 'agent needs' : 'agents need'} you` : '')
    }
    if (more && !w.isFocused()) {
      if (process.platform === 'darwin') app.dock?.bounce('informational')
      else {
        w.flashFrame(true)
        w.once('focus', () => !w.isDestroyed() && w.flashFrame(false))
      }
    }
  }

  /** Recent Workspaces in the Windows jump list and the macOS dock menu. */
  setRecent(items: Array<{ projectId: string; name: string }>): void {
    if (process.platform === 'win32') {
      // A development build starts as `electron <app folder>`: its jump list must say so.
      const prefix = app.isPackaged ? '' : `"${app.getAppPath()}" `
      app.setJumpList([
        {
          type: 'custom',
          name: 'Workspaces',
          items: items.map((item) => ({
            type: 'task' as const,
            title: item.name,
            description: `Open ${item.name}`,
            program: process.execPath,
            args: `${prefix}${openLink(item.projectId)}`,
            iconPath: process.execPath,
            iconIndex: 0
          }))
        }
      ])
    } else if (process.platform === 'darwin') {
      app.dock?.setMenu(Menu.buildFromTemplate(items.map((item) => ({ label: item.name, click: () => this.open({ kind: 'open', projectId: item.projectId }) }))))
    }
  }

  handlers(): NativeHandlers {
    return {
      'app.notify': (input) => this.notify(input),
      'app.setAttention': ({ waiting }) => this.setAttention(waiting),
      // Read once: the window asks after it starts, so a link that started Hiveory is not lost.
      'app.pendingLink': () => {
        this.windowReady = true
        const link = this.pending
        this.pending = null
        return link
      },
      'app.setRecent': ({ items }) => this.setRecent(items)
    }
  }
}
