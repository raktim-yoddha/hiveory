import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { session, WebContentsView, type BrowserWindow, type Session } from 'electron'
import {
  DEFAULT_BROWSER_PROFILE,
  type BrowserAnnotation,
  type BrowserPageView,
  type BrowserProfile,
  type BrowserState,
  type Bounds,
  type PickedElement,
  type Viewport
} from '@shared/domain'
import { fail } from '@shared/errors'
import type { Logger } from '../../app/logger'
import type { Emit } from '../events'
import { nowIso } from '../events'
import type { StateStore } from '../persistence/state-store'
import type { SettingsService } from '../settings/settings-service'
import { parseCookieFile, type CookieInput } from './cookies'
import { PageDriver } from './page-driver'
import { fitScale, isLoadable, normalizeUrl } from './urls'

export interface LogEntry {
  at: number
  level: string
  text: string
}

interface Page {
  id: string
  scope: string
  profileId: string
  ownerAgentId?: string
  ownerName?: string
  view: WebContentsView
  driver: PageDriver
  /** Where the panel shows it; null = parked off-window but still rendering. */
  shown: Bounds | null
  /** Size used while parked: the last panel size, or a laptop screen for agent-only pages. */
  size: { width: number; height: number }
  console: LogEntry[]
  network: LogEntry[]
  /** An agent is acting on the page until this time (Infinity while a tool call runs). */
  activeUntil: number
}

export interface CrawledPage {
  url: string
  text: string
}

/** Resource types a crawl skips: it reads text, it does not need pixels or sound. */
const LEAN_BLOCK = new Set(['image', 'media', 'font', 'imageset', 'object'])
/** How long the "is using this page" strip lingers after an agent's last action. */
const ACTIVE_LINGER_MS = 2500

export interface AgentRef {
  id: string
  workspaceId: string
  petName: string
}

const LOG_LIMIT = 300
const DEFAULT_SIZE = { width: 1280, height: 800 }
const ALLOWED_PERMISSIONS = new Set(['fullscreen', 'clipboard-sanitized-write'])

const push = (list: LogEntry[], entry: LogEntry): void => {
  list.push(entry)
  if (list.length > LOG_LIMIT) list.splice(0, list.length - LOG_LIMIT)
}

/**
 * The built-in browser. Pages are WebContentsViews owned by main, so they
 * keep running — and agents keep driving them — whether or not the side panel
 * shows them. A page the panel is not showing is parked off-window at a real
 * size, so layout, input and screenshots behave exactly as when visible.
 */
export class BrowserService {
  private readonly pages = new Map<string, Page>()
  /** The page each agent acts on by default. */
  private readonly current = new Map<string, string>()
  private readonly configured = new WeakSet<Session>()
  private annotations: BrowserAnnotation[] = []
  /** Pages each agent touched during its current tool call. */
  private readonly touched = new Map<string, Set<Page>>()
  /** Crawl pages: images, media and fonts are not loaded. */
  private readonly lean = new Set<number>()
  /** Crawls running per session; the request filter exists only while one runs, so normal browsing pays nothing. */
  private readonly leanSessions = new Map<Session, number>()
  private window: BrowserWindow | null = null
  private counter = 0
  private emitTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly store: StateStore,
    private readonly settings: SettingsService,
    private readonly emit: Emit,
    private readonly log: Logger
  ) {}

  // ---------- window hosting ----------

  setWindow(window: BrowserWindow | null): void {
    this.window = window
    if (!window) return
    for (const page of this.pages.values()) {
      window.contentView.addChildView(page.view)
      this.place(page)
    }
    window.on('closed', () => {
      if (this.window === window) this.window = null
    })
  }

  /**
   * A page off screen is a hidden view at its last real size: layout, input
   * and screenshots behave as when visible (PageDriver pumps a frame where
   * Chromium waits for one).
   */
  private place(page: Page): void {
    const size = page.driver.viewport ?? page.size
    page.view.setBounds(page.shown ?? { x: 0, y: 0, width: size.width, height: size.height })
    page.view.setVisible(Boolean(page.shown))
  }

  /** Shows a page in the panel at `bounds`, or parks it. With `freeze`, returns a picture of it first (for menus drawn over it). */
  async show(pageId: string, bounds: Bounds | null, freeze = false): Promise<string | null> {
    const page = this.get(pageId)
    let picture: string | null = null
    if (freeze && page.shown) {
      try {
        picture = (await page.view.webContents.capturePage()).toDataURL()
      } catch {
        picture = null
      }
    }
    if (bounds) {
      for (const other of this.pages.values()) {
        if (other !== page && other.shown) {
          other.shown = null
          this.place(other)
        }
      }
      const rounded = { x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.max(1, Math.round(bounds.width)), height: Math.max(1, Math.round(bounds.height)) }
      page.shown = rounded
      page.size = { width: rounded.width, height: rounded.height }
    } else {
      page.shown = null
    }
    this.place(page)
    // In device mode the panel sizes the box to the emulated screen, so its width gives the zoom.
    const viewport = page.driver.viewport
    if (viewport) await page.driver.emulate(viewport, page.shown ? Math.min(1, page.shown.width / viewport.width) : 1).catch(() => undefined)
    return picture
  }

  // ---------- profiles ----------

  profiles(): BrowserProfile[] {
    return [DEFAULT_BROWSER_PROFILE, ...this.store.state.browserProfiles]
  }

  private profile(profileId: string): BrowserProfile {
    return this.profiles().find((p) => p.id === profileId) ?? fail('NOT_FOUND', `No browser profile "${profileId}".`)
  }

  createProfile(name: string): BrowserProfile {
    const trimmed = name.trim() || 'Profile'
    if (this.profiles().some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) fail('INVALID_INPUT', `A profile named "${trimmed}" already exists.`)
    const profile: BrowserProfile = { id: `p${randomUUID().replace(/-/g, '').slice(0, 10)}`, name: trimmed, createdAt: nowIso() }
    this.store.update((s) => {
      s.browserProfiles.push(profile)
    })
    this.changed()
    return profile
  }

  renameProfile(profileId: string, name: string): void {
    if (profileId === DEFAULT_BROWSER_PROFILE.id) fail('INVALID_INPUT', 'The default profile cannot be renamed.')
    this.profile(profileId)
    this.store.update((s) => {
      const p = s.browserProfiles.find((x) => x.id === profileId)
      if (p) p.name = name.trim() || p.name
    })
    this.changed()
  }

  async deleteProfile(profileId: string): Promise<void> {
    if (profileId === DEFAULT_BROWSER_PROFILE.id) fail('INVALID_INPUT', 'The default profile cannot be deleted.')
    this.profile(profileId)
    for (const page of [...this.pages.values()]) if (page.profileId === profileId) this.close(page.id)
    await this.sessionFor(profileId).clearStorageData().catch(() => undefined)
    this.store.update((s) => {
      s.browserProfiles = s.browserProfiles.filter((p) => p.id !== profileId)
    })
    if (this.settings.get().browserDefaultProfile === profileId) this.settings.update({ browserDefaultProfile: DEFAULT_BROWSER_PROFILE.id })
    this.changed()
  }

  async clearData(profileId: string): Promise<void> {
    const ses = this.sessionFor(this.profile(profileId).id)
    await ses.clearStorageData()
    await ses.clearCache()
  }

  private sessionFor(profileId: string): Session {
    const ses = session.fromPartition(`persist:hv-browser-${profileId}`)
    if (this.configured.has(ses)) return ses
    this.configured.add(ses)
    // Sites block "Electron" user agents (Google sign-in among them); present as plain Chrome.
    ses.setUserAgent(ses.getUserAgent().replace(/\s(Electron|hiveory[\w-]*)\/\S+/gi, ''))
    ses.setPermissionRequestHandler((_wc, permission, callback) => callback(ALLOWED_PERMISSIONS.has(permission)))
    const record = (details: { webContentsId?: number; method: string; url: string; statusCode?: number; error?: string; resourceType: string }): void => {
      const page = [...this.pages.values()].find((p) => !p.view.webContents.isDestroyed() && p.view.webContents.id === details.webContentsId)
      if (!page) return
      const failed = details.error && details.error !== 'net::OK' ? details.error : ''
      const status = failed ? `FAILED ${failed}` : String(details.statusCode ?? '')
      push(page.network, { at: Date.now(), level: failed || (details.statusCode ?? 0) >= 400 ? 'error' : 'info', text: `${details.method} ${status} ${details.resourceType} ${details.url}` })
    }
    ses.webRequest.onCompleted((d) => record(d))
    ses.webRequest.onErrorOccurred((d) => record(d))
    return ses
  }

  // ---------- pages ----------

  state(): BrowserState {
    return { pages: [...this.pages.values()].map((p) => this.view(p)), profiles: this.profiles(), annotations: this.annotations }
  }

  private view(page: Page): BrowserPageView {
    const wc = page.view.webContents
    const alive = !wc.isDestroyed()
    return {
      id: page.id,
      scope: page.scope,
      profileId: page.profileId,
      url: alive ? wc.getURL() : '',
      title: alive ? wc.getTitle() : '',
      loading: alive && wc.isLoading(),
      canGoBack: alive && wc.navigationHistory.canGoBack(),
      canGoForward: alive && wc.navigationHistory.canGoForward(),
      ownerAgentId: page.ownerAgentId,
      ownerName: page.ownerName,
      viewport: page.driver.viewport,
      devToolsOpen: alive && wc.isDevToolsOpened(),
      agentActive: page.activeUntil > Date.now()
    }
  }

  private changed(): void {
    this.emitTimer ??= setTimeout(() => {
      this.emitTimer = null
      this.emit('browser.changed', this.state())
    }, 50)
  }

  get(pageId: string): Page {
    const page = this.pages.get(pageId)
    if (!page || page.view.webContents.isDestroyed()) return fail('NOT_FOUND', `Browser page ${pageId} is closed.`)
    return page
  }

  has(pageId: string): boolean {
    return this.pages.has(pageId)
  }

  open(input: { scope: string; url?: string; profileId?: string; owner?: AgentRef }): BrowserPageView {
    const settings = this.settings.get()
    const wanted = input.profileId ?? settings.browserDefaultProfile
    const profileId = this.profiles().some((p) => p.id === wanted) ? wanted : DEFAULT_BROWSER_PROFILE.id
    const view = new WebContentsView({
      webPreferences: {
        session: this.sessionFor(profileId),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        // Agents drive pages nobody is looking at; they must not be throttled.
        backgroundThrottling: false
      }
    })
    view.setBackgroundColor('#ffffff')
    const id = `b${++this.counter}`
    const page: Page = {
      id,
      scope: input.scope,
      profileId,
      ownerAgentId: input.owner?.id,
      ownerName: input.owner?.petName,
      view,
      driver: new PageDriver(view.webContents, () => Boolean(this.pages.get(id)?.shown)),
      shown: null,
      size: { ...DEFAULT_SIZE },
      console: [],
      network: [],
      activeUntil: 0
    }
    this.pages.set(page.id, page)
    this.wire(page)
    this.window?.contentView.addChildView(view)
    this.place(page)
    const url = input.url ?? settings.browserHomeUrl
    if (url) void page.driver.navigate(url).catch((error) => push(page.console, { at: Date.now(), level: 'error', text: String(error?.message ?? error) }))
    else void view.webContents.loadURL('about:blank')
    if (input.owner) this.current.set(input.owner.id, page.id)
    this.changed()
    return this.view(page)
  }

  private wire(page: Page): void {
    const wc = page.view.webContents
    const update = (): void => this.changed()
    for (const event of ['did-start-loading', 'did-stop-loading', 'page-title-updated', 'did-navigate', 'did-navigate-in-page', 'devtools-opened', 'devtools-closed'] as const) {
      wc.on(event as 'did-start-loading', update)
    }
    wc.on('console-message', (event) => {
      const { level, message, sourceId, lineNumber } = event as unknown as { level: string; message: string; sourceId: string; lineNumber: number }
      // Electron's own dev-mode security banner is noise, not the page's output.
      if (message.startsWith('%cElectron Security Warning')) return
      push(page.console, { at: Date.now(), level, text: `${message}${sourceId ? `  (${sourceId}:${lineNumber})` : ''}` })
    })
    // Links and redirects follow the same scheme rule as typed addresses (no custom protocols, no chrome:).
    const guard = (event: { preventDefault: () => void }, url: string): void => {
      if (!isLoadable(url)) event.preventDefault()
    }
    wc.on('will-navigate', guard)
    wc.on('will-redirect', guard)
    // Popups open as new pages beside the opener (same folder, owner and profile).
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) {
        const owner = page.ownerAgentId && page.ownerName ? { id: page.ownerAgentId, workspaceId: page.scope, petName: page.ownerName } : undefined
        this.open({ scope: page.scope, url, profileId: page.profileId, owner })
      }
      return { action: 'deny' }
    })
    wc.on('render-process-gone', (_event, details) => {
      this.log.warn(`Browser page ${page.id} crashed: ${details.reason}`)
      if (details.reason !== 'clean-exit') setTimeout(() => !wc.isDestroyed() && wc.reload(), 300)
    })
  }

  close(pageId: string): void {
    const page = this.pages.get(pageId)
    if (!page) return
    this.pages.delete(pageId)
    for (const [agent, id] of this.current) if (id === pageId) this.current.delete(agent)
    page.driver.dispose()
    try {
      this.window?.contentView.removeChildView(page.view)
    } catch {
      // Window already gone.
    }
    if (!page.view.webContents.isDestroyed()) page.view.webContents.close()
    this.annotations = this.annotations.filter((a) => a.pageId !== pageId)
    this.changed()
  }

  closeAll(): void {
    for (const id of [...this.pages.keys()]) this.close(id)
  }

  /** Reopens a page in another profile (a page's session is fixed at creation). */
  switchProfile(pageId: string, profileId: string): BrowserPageView {
    const page = this.get(pageId)
    this.profile(profileId)
    const url = page.view.webContents.getURL()
    const owner = page.ownerAgentId && page.ownerName ? { id: page.ownerAgentId, workspaceId: page.scope, petName: page.ownerName } : undefined
    const next = this.open({ scope: page.scope, url: url && url !== 'about:blank' ? url : undefined, profileId, owner })
    if (page.shown) void this.show(next.id, page.shown)
    this.close(pageId)
    return next
  }

  async navigate(pageId: string, url: string): Promise<void> {
    const page = this.get(pageId)
    if (url === 'stop') return page.view.webContents.stop()
    await page.driver.navigate(url)
  }

  async setViewport(pageId: string, viewport: Viewport | null): Promise<void> {
    const page = this.get(pageId)
    await page.driver.emulate(viewport, viewport && page.shown ? fitScale(viewport, page.shown) : 1)
    this.place(page)
    this.changed()
  }

  toggleDevTools(pageId: string): void {
    const wc = this.get(pageId).view.webContents
    if (wc.isDevToolsOpened()) wc.closeDevTools()
    else wc.openDevTools({ mode: 'detach', activate: true })
  }

  pick(pageId: string): Promise<PickedElement | null> {
    return this.get(pageId).driver.pick()
  }

  cancelPick(pageId: string): Promise<boolean> {
    return this.get(pageId).driver.cancelPick()
  }

  annotate(pageId: string, element: PickedElement, note: string): BrowserAnnotation {
    const page = this.get(pageId)
    const annotation: BrowserAnnotation = { id: randomUUID(), pageId, url: page.view.webContents.getURL(), element, note: note.trim(), createdAt: nowIso() }
    this.annotations = [...this.annotations, annotation].slice(-100)
    this.changed()
    return annotation
  }

  annotationsIn(scope: string): BrowserAnnotation[] {
    return this.annotations.filter((a) => this.pages.get(a.pageId)?.scope === scope)
  }

  deleteAnnotations(id?: string, scope?: string): void {
    this.annotations = this.annotations.filter((a) => (id ? a.id !== id : scope ? this.pages.get(a.pageId)?.scope !== scope : false))
    this.changed()
  }

  // ---------- cookies ----------

  async importCookies(profileId: string, file: string): Promise<{ imported: number; failed: number }> {
    const cookies = parseCookieFile(readFileSync(file, 'utf8'))
    if (!cookies.length) fail('INVALID_INPUT', 'No cookies found in that file.')
    return this.setCookies(profileId, cookies)
  }

  async setCookies(profileId: string, cookies: CookieInput[]): Promise<{ imported: number; failed: number }> {
    const ses = this.sessionFor(this.profile(profileId).id)
    let imported = 0
    for (const cookie of cookies) {
      try {
        await ses.cookies.set(cookie)
        imported++
      } catch {
        // Expired or malformed cookies are skipped, not fatal.
      }
    }
    return { imported, failed: cookies.length - imported }
  }

  async exportCookies(profileId: string, file: string): Promise<number> {
    const cookies = await this.cookies(profileId)
    writeFileSync(file, JSON.stringify(cookies, null, 2))
    return cookies.length
  }

  cookies(profileId: string, url?: string): Promise<Electron.Cookie[]> {
    return this.sessionFor(this.profile(profileId).id).cookies.get(url ? { url } : {})
  }

  async clearCookies(profileId: string, url?: string): Promise<number> {
    const ses = this.sessionFor(this.profile(profileId).id)
    const list = await ses.cookies.get(url ? { url } : {})
    for (const c of list) {
      const host = (c.domain ?? '').replace(/^\./, '')
      await ses.cookies.remove(`${c.secure ? 'https' : 'http'}://${host}${c.path ?? '/'}`, c.name).catch(() => undefined)
    }
    return list.length
  }

  // ---------- agent access ----------

  pagesIn(scope: string): BrowserPageView[] {
    return [...this.pages.values()].filter((p) => p.scope === scope).map((p) => this.view(p))
  }

  /** The page an agent acts on: the one it names (in its workspace), its current page, or a fresh one. */
  agentPage(agent: AgentRef, pageId?: string): Page {
    if (pageId) {
      const page = this.pages.get(pageId)
      if (!page || page.scope !== agent.workspaceId) {
        const ids = this.pagesIn(agent.workspaceId).map((p) => p.id)
        return fail('NOT_FOUND', `No page "${pageId}" in your workspace. Pages: ${ids.join(', ') || 'none'}.`)
      }
      this.current.set(agent.id, page.id)
      return this.withCursor(this.touch(agent.id, page))
    }
    const current = this.current.get(agent.id)
    if (current && this.pages.has(current)) return this.withCursor(this.touch(agent.id, this.get(current)))
    const opened = this.open({ scope: agent.workspaceId, owner: agent })
    return this.withCursor(this.touch(agent.id, this.get(opened.id)))
  }

  newAgentPage(agent: AgentRef, url?: string, profileId?: string): Page {
    const opened = this.open({ scope: agent.workspaceId, owner: agent, url, profileId })
    return this.withCursor(this.touch(agent.id, this.get(opened.id)))
  }

  /** Marks a page as being driven by an agent's running tool call. */
  private touch(agentId: string, page: Page): Page {
    if (page.activeUntil !== Infinity) {
      page.activeUntil = Infinity
      this.changed()
    }
    const set = this.touched.get(agentId) ?? new Set<Page>()
    set.add(page)
    this.touched.set(agentId, set)
    return page
  }

  /** The agent's tool call finished: its pages stop showing "is using" shortly after. */
  endActivity(agentId: string): void {
    const pages = this.touched.get(agentId)
    if (!pages) return
    this.touched.delete(agentId)
    for (const page of pages) page.activeUntil = Date.now() + ACTIVE_LINGER_MS
    this.changed()
    setTimeout(() => this.changed(), ACTIVE_LINGER_MS + 50)
  }

  /**
   * Reads a whole site in parallel: hidden lean pages (no images, media or
   * fonts) walk same-origin links breadth-first. One call instead of one
   * navigate + snapshot round trip per page.
   */
  async crawl(agent: AgentRef, start: string, options: { maxPages: number; concurrency: number; maxChars: number; profileId?: string }): Promise<CrawledPage[]> {
    const startUrl = normalizeUrl(start)
    const origin = new URL(startUrl).origin
    const clean = (href: string): string | null => {
      try {
        const u = new URL(href)
        if (u.origin !== origin || !/^https?:$/.test(u.protocol)) return null
        if (/\.(pdf|zip|png|jpe?g|gif|svg|webp|mp4|mp3|dmg|exe|msi)$/i.test(u.pathname)) return null
        u.hash = ''
        return u.href
      } catch {
        return null
      }
    }
    const queue = [clean(startUrl) ?? startUrl]
    const seen = new Set(queue)
    const results: CrawledPage[] = []
    let inflight = 0
    const workers = Array.from({ length: Math.min(options.concurrency, options.maxPages) }, () => {
      const view = this.open({ scope: `crawl-${agent.id}`, profileId: options.profileId })
      const page = this.get(view.id)
      this.lean.add(page.view.webContents.id)
      page.driver.cursorMs = 0
      return page
    })
    const work = async (page: Page): Promise<void> => {
      for (;;) {
        if (results.length + inflight >= options.maxPages) return
        const url = queue.shift()
        if (!url) {
          if (!inflight) return
          await new Promise((r) => setTimeout(r, 40))
          continue
        }
        inflight++
        try {
          await page.driver.navigate(url)
          // Refs are useless once the crawl page closes; dropping them saves tokens.
          const text = (await page.driver.snapshot(true)).replace(/ \[@\d+\]/g, '')
          results.push({ url: page.view.webContents.getURL() || url, text: text.length > options.maxChars ? `${text.slice(0, options.maxChars)}\n… (page cut)` : text })
          for (const href of await page.driver.call<string[]>('links()')) {
            const next = clean(href)
            if (next && !seen.has(next)) {
              seen.add(next)
              queue.push(next)
            }
          }
        } catch (error) {
          results.push({ url, text: `(could not read: ${error instanceof Error ? error.message : String(error)})` })
        } finally {
          inflight--
        }
      }
    }
    const ses = workers[0]!.view.webContents.session
    const running = this.leanSessions.get(ses) ?? 0
    if (!running) ses.webRequest.onBeforeRequest((d, callback) => callback({ cancel: this.lean.has(d.webContentsId ?? -1) && LEAN_BLOCK.has(d.resourceType) }))
    this.leanSessions.set(ses, running + 1)
    try {
      await Promise.all(workers.map(work))
    } finally {
      const left = (this.leanSessions.get(ses) ?? 1) - 1
      this.leanSessions.set(ses, left)
      if (!left) ses.webRequest.onBeforeRequest(null)
      for (const page of workers) {
        this.lean.delete(page.view.webContents.id)
        this.close(page.id)
      }
    }
    return results
  }

  private withCursor(page: Page): Page {
    page.driver.cursorMs = this.settings.get().browserAgentCursor ? 110 : 0
    return page
  }

  isCurrent(agentId: string, pageId: string): boolean {
    return this.current.get(agentId) === pageId
  }

  pageView(page: Page): BrowserPageView {
    return this.view(page)
  }

  notifyChanged(): void {
    this.changed()
  }
}
