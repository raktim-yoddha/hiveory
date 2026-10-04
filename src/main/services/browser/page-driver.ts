import type { WebContents } from 'electron'
import { isMobileViewport, type PickedElement, type Viewport } from '@shared/domain'
import { parseKeys } from './keys'
import { pageCall } from './page-script'
import { diffLines, diffWorthIt } from './snapshot-diff'
import { normalizeUrl } from './urls'

/** Isolated world id for Hiveory's page script (any id above 999 is free for embedders). */
const WORLD = 1717
const MAX_SNAPSHOT = 24000
const LOAD_TIMEOUT_MS = 30000
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class PageError extends Error {}

export interface ActionOptions {
  label?: string
  force?: boolean
}

export interface Screenshot {
  data: Buffer
  width: number
  height: number
}

interface Point {
  x: number
  y: number
  desc: string
  covered?: string
}

/**
 * Drives one page: trusted input over the in-process DevTools protocol, page
 * state through the isolated-world script. No network hop, no separate
 * browser — every call is a direct IPC into the page's renderer.
 */
export class PageDriver {
  /** Animated cursor moves; 0 when the cursor is off, so actions run at full speed. */
  cursorMs = 110
  private emulated: Viewport | null = null
  private lastSnapshot: { url: string; lines: string[] } | null = null

  constructor(
    private readonly wc: WebContents,
    /** Whether the page is on screen (frames flow by themselves). */
    private readonly visible: () => boolean = () => false
  ) {}

  private async cdp<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.wc.debugger.isAttached()) this.wc.debugger.attach('1.3')
    return (await this.wc.debugger.sendCommand(method, params)) as T
  }

  /** Calls the page script. Errors it throws come back as PageError with its message. */
  async call<T>(expression: string): Promise<T> {
    const result = (await this.wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: pageCall(expression) }], true)) as
      | { ok: true; value: T }
      | { ok: false; error: string }
      | undefined
    if (!result) throw new PageError('The page did not answer (it may still be loading).')
    if (!result.ok) throw new PageError(result.error)
    return result.value
  }

  // ---------- navigation & waits ----------

  async navigate(input: string): Promise<void> {
    const wc = this.wc
    if (input === 'back') return this.history(() => wc.navigationHistory.goBack(), wc.navigationHistory.canGoBack())
    if (input === 'forward') return this.history(() => wc.navigationHistory.goForward(), wc.navigationHistory.canGoForward())
    if (input === 'reload') {
      wc.reload()
      return this.settle(true)
    }
    const url = normalizeUrl(input)
    try {
      await Promise.race([wc.loadURL(url), sleep(LOAD_TIMEOUT_MS)])
    } catch (error) {
      // Redirects and in-page aborts reject with ERR_ABORTED; the page still lands somewhere.
      const message = error instanceof Error ? error.message : String(error)
      if (!/ERR_ABORTED|\(-3\)/.test(message)) throw new PageError(`Could not open ${url}: ${message}`)
    }
    await this.settle()
  }

  private async history(go: () => void, possible: boolean): Promise<void> {
    if (!possible) throw new PageError('There is no page to go to in that direction.')
    go()
    await this.settle(true)
  }

  /** Waits for a started navigation to finish, then for the DOM to stop changing (short idle, hard cap). */
  async settle(expectNavigation = false): Promise<void> {
    await sleep(expectNavigation ? 80 : 10)
    if (this.wc.isLoading()) {
      await new Promise<void>((resolve) => {
        const done = (): void => {
          clearTimeout(timer)
          this.wc.off('did-stop-loading', done)
          resolve()
        }
        const timer = setTimeout(done, LOAD_TIMEOUT_MS)
        this.wc.once('did-stop-loading', done)
      })
    }
    await this.call('quiet(40, 600)').catch(() => undefined)
  }

  async waitFor(condition: { text?: string; selector?: string; url?: string; gone?: boolean }, timeoutMs: number): Promise<string> {
    const deadline = Date.now() + timeoutMs
    const { text, selector, url, gone = false } = condition
    if (!text && !selector && !url) {
      await sleep(Math.min(timeoutMs, 30000))
      return `Waited ${Math.round(Math.min(timeoutMs, 30000) / 1000)}s.`
    }
    const what = text ? `text ${JSON.stringify(text)}` : selector ? `selector ${JSON.stringify(selector)}` : `URL containing ${JSON.stringify(url)}`
    for (;;) {
      let met: boolean
      try {
        if (url) met = this.wc.getURL().includes(url)
        else if (text) met = await this.call<boolean>(`hasText(${JSON.stringify(text)})`)
        else met = (await this.call<number>(`count(${JSON.stringify(selector)})`)) > 0
      } catch {
        met = false
      }
      if (met !== gone) return `${gone ? 'Gone' : 'Found'}: ${what}.`
      if (Date.now() >= deadline) throw new PageError(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${what}${gone ? ' to disappear' : ''}.`)
      await sleep(120)
    }
  }

  // ---------- observation ----------

  /**
   * The page as compact text. `diff` returns only the lines that changed since
   * this page's last viewport snapshot when that is clearly shorter.
   */
  async snapshot(full = false, mode: 'full' | 'diff' = 'full'): Promise<string> {
    const s = await this.call<{ text: string; truncated: boolean; scrollY: number; scrollMax: number; viewport: string }>(
      `snapshot(${full}, ${MAX_SNAPSHOT})`
    )
    const url = this.wc.getURL()
    const header = `Page: ${this.wc.getTitle() || '(untitled)'} — ${url}`
    if (!full) {
      const lines = s.text ? s.text.split('\n') : []
      const previous = this.lastSnapshot
      this.lastSnapshot = { url, lines }
      if (mode === 'diff' && previous?.url === url) {
        const diff = diffLines(previous.lines, lines)
        if (!diff.added.length && !diff.removed.length) return `${header}\n(no visible change since your last snapshot)`
        if (diffWorthIt(diff, lines.length)) {
          return `${header}\n(changes since your last snapshot — unchanged lines omitted; refs stay valid)\n${[
            ...diff.removed.map((l) => `− ${l.trim()}`),
            ...diff.added.map((l) => `+ ${l.trim()}`)
          ].join('\n')}`
        }
      }
    }
    const where = full
      ? 'whole page'
      : s.scrollMax > 0
        ? `viewport ${s.viewport}, scrolled ${Math.round((s.scrollY / s.scrollMax) * 100)}% — use browser_scroll or full_page for more`
        : `viewport ${s.viewport}, whole page visible`
    const tail = s.truncated ? '\n… (cut to fit; scroll, or act on what you see)' : ''
    return `${header}\n(${where})\n${s.text || '(no visible content)'}${tail}`
  }

  async screenshot(options: { fullPage?: boolean; target?: string } = {}): Promise<Screenshot> {
    const metrics = await this.cdp<{
      cssVisualViewport: { pageX: number; pageY: number; clientWidth: number; clientHeight: number }
      cssContentSize: { width: number; height: number }
    }>('Page.getLayoutMetrics')
    const v = metrics.cssVisualViewport
    let clip = { x: v.pageX, y: v.pageY, width: v.clientWidth, height: v.clientHeight }
    if (options.target) {
      const r = await this.call<{ x: number; y: number; width: number; height: number }>(`rect(${JSON.stringify(options.target)})`)
      const after = await this.call<{ x: number; y: number }>('scroll()')
      clip = { x: r.x + after.x, y: r.y + after.y, width: Math.max(1, r.width), height: Math.max(1, r.height) }
    } else if (options.fullPage) {
      clip = { x: 0, y: 0, width: metrics.cssContentSize.width, height: Math.min(metrics.cssContentSize.height, 16000) }
    }
    const shot = await this.cdp<{ data: string }>('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: Boolean(options.fullPage),
      clip: { ...clip, scale: 1 }
    })
    return { data: Buffer.from(shot.data, 'base64'), width: Math.round(clip.width), height: Math.round(clip.height) }
  }

  async evaluate(script: string): Promise<string> {
    // Expression first ("document.title"), then as a function body ("const a = 1; return a").
    const asExpression = `(async () => (\n${script}\n))()`
    const asBody = `(async () => {\n${script}\n})()`
    let value: unknown
    try {
      value = await this.wc.executeJavaScript(asExpression, true)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!/SyntaxError|Unexpected|Script failed to execute/i.test(message)) throw new PageError(message)
      try {
        value = await this.wc.executeJavaScript(asBody, true)
      } catch (inner) {
        throw new PageError(inner instanceof Error ? inner.message : String(inner))
      }
    }
    if (value === undefined) return 'undefined'
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
    return text.length > 20000 ? `${text.slice(0, 20000)}\n… (cut at 20000 characters)` : text
  }

  pick(): Promise<PickedElement | null> {
    return this.call<PickedElement | null>('pick()')
  }

  cancelPick(): Promise<boolean> {
    return this.call<boolean>('cancelPick()').catch(() => false)
  }

  // ---------- pointer ----------

  private async target(target: string, options: ActionOptions): Promise<Point> {
    const p = await this.call<Point>(`point(${JSON.stringify(target)})`)
    if (p.covered && !options.force) {
      throw new PageError(`${p.desc} is covered by ${p.covered}. Close or scroll past it first, or pass force: true.`)
    }
    return p
  }

  /** Starts the cursor glide and acts almost at once: the animation finishes alongside the input, not before it. */
  private async moveCursor(x: number, y: number, label?: string): Promise<void> {
    if (!this.cursorMs) return
    await this.call(`cursorTo(${x}, ${y}, ${JSON.stringify(label ?? '')}, ${this.cursorMs})`).catch(() => undefined)
    await sleep(Math.min(this.cursorMs, 25))
  }

  /**
   * Mouse moves and wheel turns are frame-aligned in Chromium: on a page no
   * one is looking at they wait for a frame that does not come (~1 s). A
   * press flushes them at once; for moves without a press, one stay-hidden
   * capture produces the frame.
   */
  private async move(x: number, y: number, extra: Record<string, unknown> = {}): Promise<void> {
    void this.mouse('mouseMoved', x, y, extra).catch(() => undefined)
    await this.pump()
  }

  private async pump(): Promise<void> {
    if (this.visible()) return
    await this.wc.capturePage({ x: 0, y: 0, width: 1, height: 1 }, { stayHidden: true }).catch(() => undefined)
  }

  private mouse(type: string, x: number, y: number, extra: Record<string, unknown> = {}): Promise<unknown> {
    return this.cdp('Input.dispatchMouseEvent', { type, x, y, button: 'none', buttons: 0, ...extra })
  }

  async click(target: string, options: ActionOptions & { double?: boolean; button?: 'left' | 'right' | 'middle' } = {}): Promise<string> {
    const p = await this.target(target, options)
    await this.moveCursor(p.x, p.y, options.label)
    const button = options.button ?? 'left'
    const buttons = button === 'left' ? 1 : button === 'right' ? 2 : 4
    // Not awaited: the press right after flushes this frame-aligned move at once (see move()).
    void this.mouse('mouseMoved', p.x, p.y).catch(() => undefined)
    for (let count = 1; count <= (options.double ? 2 : 1); count++) {
      await this.mouse('mousePressed', p.x, p.y, { button, buttons, clickCount: count })
      await this.mouse('mouseReleased', p.x, p.y, { button, buttons: 0, clickCount: count })
    }
    if (this.cursorMs) void this.call(`ripple(${p.x}, ${p.y})`).catch(() => undefined)
    await this.settle()
    return `${options.double ? 'Double-clicked' : button === 'right' ? 'Right-clicked' : 'Clicked'} ${p.desc}.`
  }

  async hover(target: string, options: ActionOptions = {}): Promise<string> {
    const p = await this.target(target, { ...options, force: true })
    await this.moveCursor(p.x, p.y, options.label)
    await this.move(p.x, p.y)
    await this.settle()
    return `Hovering ${p.desc}.`
  }

  /** Mouse drag that also completes HTML5 drag-and-drop (Chromium intercepts the drag and replays it as drag events). */
  async drag(from: string, to: string, options: ActionOptions = {}): Promise<string> {
    const a = await this.target(from, options)
    await this.moveCursor(a.x, a.y, options.label)
    let intercepted: unknown = null
    const onMessage = (_event: unknown, method: string, params: { data?: unknown }): void => {
      if (method === 'Input.dragIntercepted') intercepted = params.data
    }
    this.wc.debugger.on('message', onMessage)
    try {
      await this.cdp('Input.setInterceptDrags', { enabled: true })
      void this.mouse('mouseMoved', a.x, a.y).catch(() => undefined)
      await this.mouse('mousePressed', a.x, a.y, { button: 'left', buttons: 1, clickCount: 1 })
      // Resolve the drop point after pressing: lists often re-layout once a drag starts.
      const b = await this.target(to, { force: true })
      const steps = 8
      let entered = false
      for (let i = 1; i <= steps; i++) {
        const x = Math.round(a.x + ((b.x - a.x) * i) / steps)
        const y = Math.round(a.y + ((b.y - a.y) * i) / steps)
        if (this.cursorMs) void this.call(`cursorTo(${x}, ${y}, ${JSON.stringify(options.label ?? '')}, 30)`).catch(() => undefined)
        // Once Chromium has intercepted an HTML5 drag, mouse moves stall; continue with drag events.
        if (intercepted) {
          await this.cdp('Input.dispatchDragEvent', { type: entered ? 'dragOver' : 'dragEnter', x, y, data: intercepted })
          entered = true
        } else {
          await this.move(x, y, { button: 'left', buttons: 1 })
        }
        await sleep(16)
      }
      if (intercepted) {
        if (!entered) await this.cdp('Input.dispatchDragEvent', { type: 'dragEnter', x: b.x, y: b.y, data: intercepted })
        await this.cdp('Input.dispatchDragEvent', { type: 'dragOver', x: b.x, y: b.y, data: intercepted })
        await this.cdp('Input.dispatchDragEvent', { type: 'drop', x: b.x, y: b.y, data: intercepted })
      }
      await this.mouse('mouseReleased', b.x, b.y, { button: 'left', buttons: 0, clickCount: 1 })
      await this.settle()
      return `Dragged ${a.desc} to ${b.desc}.`
    } finally {
      this.wc.debugger.off('message', onMessage)
      await this.cdp('Input.setInterceptDrags', { enabled: false }).catch(() => undefined)
    }
  }

  async scroll(options: { target?: string; dx?: number; dy?: number }): Promise<string> {
    let x: number
    let y: number
    if (options.target) {
      const p = await this.target(options.target, { force: true })
      x = p.x
      y = p.y
    } else {
      const view = await this.call<{ w: number; h: number }>('scroll()')
      x = Math.round(view.w / 2)
      y = Math.round(view.h / 2)
    }
    void this.mouse('mouseWheel', x, y, { deltaX: options.dx ?? 0, deltaY: options.dy ?? 0 }).catch(() => undefined)
    await this.pump()
    await this.call('quiet(80, 500)').catch(() => undefined)
    const after = await this.call<{ x: number; y: number }>('scroll()')
    return `Scrolled; now at x=${after.x}, y=${after.y}.`
  }

  // ---------- keyboard & forms ----------

  async fill(target: string, text: string, options: ActionOptions & { submit?: boolean } = {}): Promise<string> {
    const p = await this.target(target, { ...options, force: true })
    await this.moveCursor(p.x, p.y, options.label)
    const field = await this.call<string>(`focusEditable(${JSON.stringify(target)})`)
    if (text) await this.cdp('Input.insertText', { text })
    else await this.press('Delete', false)
    if (options.submit) await this.press('Enter', false)
    await this.settle(Boolean(options.submit))
    return `Filled ${field}${options.submit ? ' and pressed Enter' : ''}.`
  }

  async type(text: string): Promise<void> {
    await this.cdp('Input.insertText', { text })
  }

  async press(keys: string, settle = true): Promise<string> {
    for (const chord of parseKeys(keys)) {
      const typing = !(chord.modifiers & (1 | 2 | 4))
      for (const key of chord.keys) {
        const base = { key: key.key, code: key.code, windowsVirtualKeyCode: key.keyCode, nativeVirtualKeyCode: key.keyCode, modifiers: chord.modifiers }
        await this.cdp('Input.dispatchKeyEvent', { type: typing && key.text ? 'keyDown' : 'rawKeyDown', ...base, ...(typing && key.text ? { text: key.text, unmodifiedText: key.text } : {}) })
        await this.cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
      }
    }
    if (settle) await this.settle()
    return `Pressed ${keys}.`
  }

  async select(target: string, values: string[]): Promise<string> {
    const labels = await this.call<string[]>(`selectOption(${JSON.stringify(target)}, ${JSON.stringify(values)})`)
    await this.settle()
    return `Selected ${labels.map((l) => JSON.stringify(l)).join(', ')}.`
  }

  // ---------- emulation ----------

  get viewport(): Viewport | null {
    return this.emulated
  }

  /** Emulates a screen size, scaled down to fit `area` (the visible panel) when it is larger. */
  async emulate(viewport: Viewport | null, scale = 1): Promise<void> {
    this.emulated = viewport
    if (!viewport) {
      await this.cdp('Emulation.clearDeviceMetricsOverride')
      await this.cdp('Emulation.setTouchEmulationEnabled', { enabled: false })
      await this.cdp('Emulation.setUserAgentOverride', { userAgent: this.wc.getUserAgent() })
      return
    }
    const mobile = isMobileViewport(viewport)
    await this.cdp('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.scale ?? 0,
      mobile,
      scale
    })
    await this.cdp('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 0 })
    const ua = this.wc.getUserAgent()
    await this.cdp('Emulation.setUserAgentOverride', {
      userAgent: mobile ? ua.replace(/\([^)]*\)/, '(Linux; Android 14; Pixel 8)').replace(/Safari\//, 'Mobile Safari/') : ua
    })
  }

  dispose(): void {
    try {
      if (this.wc.debugger.isAttached()) this.wc.debugger.detach()
    } catch {
      // Already gone with the page.
    }
  }
}
