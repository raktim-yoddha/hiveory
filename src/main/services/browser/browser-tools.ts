import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { VIEWPORT_PRESETS, type Viewport } from '@shared/domain'
import { AppException } from '@shared/errors'
import type { ToolDefinition, ToolResult } from '../agent-tools/mcp-protocol'
import { int, str, ToolError } from '../agent-tools/tool-args'
import type { AgentRef, BrowserService, LogEntry } from './browser-service'
import { PageError, type PageDriver } from './page-driver'

type Args = Record<string, unknown>

const page = { type: 'string', description: 'Page id from browser_pages. Default: your current page (opened for you on first use).' }
const target = {
  type: 'string',
  description: 'Element: a snapshot ref like "@12" (preferred), "text=Sign in", or a CSS selector.'
}
const label = { type: 'string', description: 'Optional 2–6 word caption shown beside your cursor, e.g. "open pricing".' }
const snapshot = { type: 'boolean', default: true, description: 'Return a fresh snapshot of the page afterwards (default true).' }
const force = { type: 'boolean', default: false, description: 'Act even if another element covers the target.' }

const tool = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []): ToolDefinition => ({
  name,
  description,
  inputSchema: { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false }
})

/** Steps browser_batch accepts — the same actions (and argument names) as the single tools. */
const BATCH_ACTIONS = ['navigate', 'click', 'hover', 'drag', 'fill', 'press', 'select', 'scroll', 'wait', 'evaluate'] as const
type Action = (typeof BATCH_ACTIONS)[number]

const formatLog = (entries: LogEntry[], limit: number): string =>
  entries
    .slice(-limit)
    .map((e) => `[${new Date(e.at).toISOString().slice(11, 19)}] ${e.level.toUpperCase()} ${e.text.slice(0, 500)}`)
    .join('\n')

/**
 * The browser half of Hiveory's MCP toolkit. Built for few round trips:
 * actions return a fresh compact snapshot, refs (`@12`) stay stable between
 * calls, and browser_batch runs a whole sequence in one call.
 */
export class BrowserTools {
  private shots = 0

  constructor(
    private readonly browser: BrowserService,
    private readonly shotsDir: string,
    private readonly customViewports: () => Viewport[]
  ) {}

  definitions(): ToolDefinition[] {
    const viewports = [...VIEWPORT_PRESETS, ...this.customViewports()].map((v) => v.name)
    return [
      tool(
        'browser_navigate',
        "Open a URL in Hiveory's built-in browser (also \"back\", \"forward\", \"reload\"). Bare hosts work (localhost:5173, example.com). Returns a snapshot.",
        {
          url: { type: 'string' },
          page,
          new_page: { type: 'boolean', default: false, description: 'Open in a new page instead of reusing yours.' },
          profile: { type: 'string', description: 'Profile id for a new page (see browser_profiles); profiles keep separate logins.' },
          snapshot
        },
        ['url']
      ),
      tool(
        'browser_snapshot',
        'Read the page as compact structured text. Interactive elements carry refs like [@12] to pass as `target`. Covers the viewport unless full_page.',
        { page, full_page: { type: 'boolean', default: false } }
      ),
      tool('browser_click', 'Click an element (moves the visible agent cursor to it).', {
        target,
        double: { type: 'boolean', default: false },
        button: { type: 'string', enum: ['left', 'right', 'middle'], default: 'left' },
        label,
        force,
        page,
        snapshot
      }, ['target']),
      tool('browser_hover', 'Move the cursor over an element (menus, tooltips).', { target, label, page, snapshot }, ['target']),
      tool('browser_drag', 'Drag one element onto another (works for HTML5 drag-and-drop, sliders, sortable lists).', {
        from: target,
        to: { ...target, description: 'Drop target, same forms as `from`.' },
        label,
        force,
        page,
        snapshot
      }, ['from', 'to']),
      tool('browser_fill', 'Replace the text of a field. Set submit to press Enter after.', {
        target,
        text: { type: 'string', description: 'New value ("" clears the field).' },
        submit: { type: 'boolean', default: false },
        label,
        page,
        snapshot
      }, ['target', 'text']),
      tool('browser_press', 'Type text into the focused element and/or press keys: "Enter", "Control+A", "Shift+Tab", "ArrowDown ArrowDown Enter".', {
        text: { type: 'string', description: 'Text to type first (optional).' },
        keys: { type: 'string', description: 'Keys to press after the text (optional).' },
        page,
        snapshot
      }),
      tool('browser_select', 'Choose option(s) in a native <select> by value or visible label.', {
        target,
        values: { type: 'array', items: { type: 'string' }, minItems: 1 },
        page,
        snapshot
      }, ['target', 'values']),
      tool('browser_scroll', 'Scroll the page (or the scrollable element under `target`). Positive dy scrolls down.', {
        dy: { type: 'integer', default: 600 },
        dx: { type: 'integer', default: 0 },
        target: { ...target, description: 'Optional element to scroll inside.' },
        page,
        snapshot
      }),
      tool('browser_wait', 'Wait until text or a selector appears (or disappears with gone), or the URL contains a string.', {
        text: { type: 'string' },
        selector: { type: 'string' },
        url: { type: 'string' },
        gone: { type: 'boolean', default: false },
        timeout_ms: { type: 'integer', minimum: 100, maximum: 120000, default: 10000 },
        page,
        snapshot: { ...snapshot, default: false }
      }),
      tool('browser_screenshot', 'Capture the page (or one element) as an image. Use for visual checks; prefer snapshots for reading.', {
        target: { ...target, description: 'Optional element to capture.' },
        full_page: { type: 'boolean', default: false },
        page
      }),
      tool('browser_evaluate', 'Run JavaScript in the page and return the result as JSON. An expression ("document.title") or a function body with return. Async is fine.', {
        script: { type: 'string', maxLength: 50000 },
        page
      }, ['script']),
      tool(
        'browser_batch',
        'Fastest way to act: run several steps in ONE call, stopping at the first failure, then return one snapshot. Each step is {"action": ' +
          BATCH_ACTIONS.map((a) => `"${a}"`).join('|') +
          ', ...the same arguments as that browser_* tool}. Example: [{"action":"fill","target":"@4","text":"me@x.dev"},{"action":"fill","target":"@5","text":"pw"},{"action":"click","target":"text=Sign in"},{"action":"wait","url":"/dashboard"}].',
        {
          steps: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'object', properties: { action: { type: 'string', enum: [...BATCH_ACTIONS] } }, required: ['action'] } },
          page,
          snapshot
        },
        ['steps']
      ),
      tool('browser_pages', 'List the browser pages in your workspace, open a new one, switch your current page, or close one you opened.', {
        action: { type: 'string', enum: ['list', 'new', 'select', 'close'], default: 'list' },
        page: { type: 'string', description: 'For select/close.' },
        url: { type: 'string', description: 'For new.' },
        profile: { type: 'string', description: 'For new: profile id (browser_profiles).' }
      }),
      tool('browser_viewport', 'Emulate a device screen size (touch + mobile layout below 768px wide), or reset to the panel size.', {
        preset: { type: 'string', enum: viewports },
        width: { type: 'integer', minimum: 200, maximum: 4000 },
        height: { type: 'integer', minimum: 200, maximum: 4000 },
        reset: { type: 'boolean', default: false },
        page,
        snapshot: { ...snapshot, default: false }
      }),
      tool('browser_cookies', "Read, set or clear cookies in the page's profile (shared by every page using that profile).", {
        action: { type: 'string', enum: ['get', 'set', 'clear'], default: 'get' },
        url: { type: 'string', description: 'Limit get/clear to cookies sent to this URL. Default for get: the current page URL.' },
        all: { type: 'boolean', default: false, description: 'For get/clear: every cookie in the profile.' },
        cookies: {
          type: 'array',
          description: 'For set: [{name, value, url | domain, path?, secure?, httpOnly?, expirationDate?, sameSite?}].',
          items: { type: 'object' }
        },
        page
      }),
      tool('browser_console', "Read the page's console messages (DevTools Console).", {
        level: { type: 'string', enum: ['all', 'warning', 'error'], default: 'all' },
        limit: { type: 'integer', minimum: 1, maximum: 300, default: 60 },
        clear: { type: 'boolean', default: false },
        page
      }),
      tool('browser_network', "Read the page's recent network requests (DevTools Network): method, status, type, URL.", {
        filter: { type: 'string', description: 'Only requests whose line contains this text.' },
        failed_only: { type: 'boolean', default: false },
        limit: { type: 'integer', minimum: 1, maximum: 300, default: 60 },
        clear: { type: 'boolean', default: false },
        page
      }),
      tool('browser_annotations', 'Read the notes the user pinned to page elements (Annotate in the browser toolbar). Each has a ref you can act on.', {
        clear: { type: 'boolean', default: false, description: 'Remove them after reading.' }
      }),
      tool('browser_profiles', 'List browser profiles (separate cookies/logins) or create one.', {
        action: { type: 'string', enum: ['list', 'create'], default: 'list' },
        name: { type: 'string' }
      }),
      tool('browser_devtools', 'Open (or close) Chrome DevTools for a page so the user can inspect it with you.', { page })
    ]
  }

  async call(agent: AgentRef, name: string, args: Args): Promise<ToolResult> {
    try {
      return await this.dispatch(agent, name, args)
    } catch (error) {
      if (error instanceof ToolError || error instanceof PageError) return { text: error.message, isError: true }
      if (error instanceof AppException) return { text: error.message, isError: true }
      return { text: `The browser could not do that: ${error instanceof Error ? error.message : String(error)}`, isError: true }
    }
  }

  private async dispatch(agent: AgentRef, name: string, args: Args): Promise<ToolResult> {
    const browser = this.browser
    const pageId = str(args, 'page', false) || undefined
    switch (name) {
      case 'browser_navigate': {
        const p = args.new_page ? browser.newAgentPage(agent, undefined, str(args, 'profile', false) || undefined) : browser.agentPage(agent, pageId)
        const message = await this.act(p.driver, 'navigate', args)
        return this.withSnapshot(p.id, p.driver, message, args)
      }
      case 'browser_snapshot': {
        const p = browser.agentPage(agent, pageId)
        return { text: `[page ${p.id}] ${await p.driver.snapshot(args.full_page === true)}` }
      }
      case 'browser_click':
      case 'browser_hover':
      case 'browser_drag':
      case 'browser_fill':
      case 'browser_press':
      case 'browser_select':
      case 'browser_scroll':
      case 'browser_wait':
      case 'browser_evaluate': {
        const p = browser.agentPage(agent, pageId)
        const action = name.slice('browser_'.length) as Action
        const message = await this.act(p.driver, action, args)
        if (action === 'evaluate') return { text: message }
        return this.withSnapshot(p.id, p.driver, message, args, action !== 'wait')
      }
      case 'browser_batch': {
        const p = browser.agentPage(agent, pageId)
        const steps = Array.isArray(args.steps) ? (args.steps as Args[]) : []
        if (!steps.length) throw new ToolError('steps must be a non-empty array.')
        const log: string[] = []
        let failed = false
        for (const [i, step] of steps.entries()) {
          const action = String(step?.action ?? '') as Action
          if (!BATCH_ACTIONS.includes(action)) {
            log.push(`${i + 1}. ✗ unknown action "${action}" (use ${BATCH_ACTIONS.join(', ')})`)
            failed = true
            break
          }
          try {
            log.push(`${i + 1}. ✓ ${await this.act(p.driver, action, step)}`)
          } catch (error) {
            log.push(`${i + 1}. ✗ ${action}: ${error instanceof Error ? error.message : String(error)}`)
            failed = true
            break
          }
        }
        if (failed && log.length < steps.length) log.push(`(stopped; ${steps.length - log.length} step(s) not run)`)
        const result = await this.withSnapshot(p.id, p.driver, log.join('\n'), args)
        return { ...result, isError: failed }
      }
      case 'browser_screenshot': {
        const p = browser.agentPage(agent, pageId)
        const shot = await p.driver.screenshot({ fullPage: args.full_page === true, target: str(args, 'target', false) || undefined })
        mkdirSync(this.shotsDir, { recursive: true })
        const file = join(this.shotsDir, `${p.id}-${this.shots++ % 10}.png`)
        writeFileSync(file, shot.data)
        return { text: `Screenshot of page ${p.id} (${shot.width}×${shot.height}) saved to ${file}`, image: { data: shot.data.toString('base64'), mimeType: 'image/png' } }
      }
      case 'browser_pages':
        return { text: await this.pages(agent, args) }
      case 'browser_viewport': {
        const p = browser.agentPage(agent, pageId)
        let viewport: Viewport | null = null
        if (args.reset !== true) {
          const preset = str(args, 'preset', false)
          if (preset) {
            viewport = [...VIEWPORT_PRESETS, ...this.customViewports()].find((v) => v.name.toLowerCase() === preset.toLowerCase()) ?? null
            if (!viewport) throw new ToolError(`No viewport "${preset}".`)
          } else {
            const width = int(args, 'width', 0, 0, 4000)
            const height = int(args, 'height', 0, 0, 4000)
            if (width < 200 || height < 200) throw new ToolError('Give a preset, width and height (200–4000), or reset: true.')
            viewport = { name: `${width}×${height}`, width, height }
          }
        }
        await browser.setViewport(p.id, viewport)
        const message = viewport ? `Viewport set to ${viewport.name} (${viewport.width}×${viewport.height}).` : 'Viewport reset to the panel size.'
        return this.withSnapshot(p.id, p.driver, message, args, false)
      }
      case 'browser_cookies':
        return { text: await this.cookies(agent, pageId, args) }
      case 'browser_console':
      case 'browser_network': {
        const p = browser.agentPage(agent, pageId)
        const list = name === 'browser_console' ? p.console : p.network
        let entries = list
        if (name === 'browser_console') {
          const level = str(args, 'level', false) || 'all'
          if (level === 'error') entries = list.filter((e) => e.level === 'error')
          else if (level === 'warning') entries = list.filter((e) => e.level === 'error' || e.level === 'warning')
        } else {
          const filter = str(args, 'filter', false).toLowerCase()
          entries = list.filter((e) => (!filter || e.text.toLowerCase().includes(filter)) && (args.failed_only !== true || e.level === 'error'))
        }
        const text = formatLog(entries, int(args, 'limit', 60, 1, 300))
        if (args.clear === true) list.length = 0
        return { text: text || `(no ${name === 'browser_console' ? 'console messages' : 'requests'} recorded for page ${p.id})` }
      }
      case 'browser_annotations': {
        const notes = browser.annotationsIn(agent.workspaceId)
        if (args.clear === true) browser.deleteAnnotations(undefined, agent.workspaceId)
        if (!notes.length) return { text: 'The user has not annotated anything in your workspace.' }
        return {
          text: notes
            .map((a, i) => `${i + 1}. page ${a.pageId} · ${a.url}\n   element: ${a.element.role} "${a.element.name}" ref ${a.element.ref} · selector ${a.element.selector}\n   note: ${a.note}`)
            .join('\n')
        }
      }
      case 'browser_profiles': {
        if (str(args, 'action', false) === 'create') {
          const created = browser.createProfile(str(args, 'name'))
          return { text: `Created profile "${created.name}" (id ${created.id}). Open a page in it with browser_navigate new_page + profile.` }
        }
        return { text: browser.profiles().map((p) => `- ${p.id}: ${p.name}`).join('\n') }
      }
      case 'browser_devtools': {
        const p = browser.agentPage(agent, pageId)
        browser.toggleDevTools(p.id)
        return { text: `Toggled DevTools for page ${p.id}. Use browser_console / browser_network to read them yourself.` }
      }
      default:
        throw new ToolError(`Unknown tool: ${name}`)
    }
  }

  /** One action — shared by the single tools and browser_batch. */
  private async act(driver: PageDriver, action: Action, args: Args): Promise<string> {
    const options = { label: str(args, 'label', false) || undefined, force: args.force === true }
    switch (action) {
      case 'navigate': {
        const url = str(args, 'url')
        await driver.navigate(url)
        return url === 'back' ? 'Went back.' : url === 'forward' ? 'Went forward.' : url === 'reload' ? 'Reloaded.' : `Opened ${url}.`
      }
      case 'click':
        return driver.click(str(args, 'target'), { ...options, double: args.double === true, button: (str(args, 'button', false) || 'left') as 'left' })
      case 'hover':
        return driver.hover(str(args, 'target'), options)
      case 'drag':
        return driver.drag(str(args, 'from'), str(args, 'to'), options)
      case 'fill': {
        if (typeof args.text !== 'string') throw new ToolError('Missing required argument "text".')
        return driver.fill(str(args, 'target'), args.text, { ...options, submit: args.submit === true })
      }
      case 'press': {
        const text = typeof args.text === 'string' ? args.text : ''
        const keys = str(args, 'keys', false)
        if (!text && !keys) throw new ToolError('Give text, keys, or both.')
        if (text) await driver.type(text)
        if (keys) await driver.press(keys)
        else await driver.settle()
        return [text && `Typed ${JSON.stringify(text.length > 60 ? `${text.slice(0, 60)}…` : text)}`, keys && `pressed ${keys}`].filter(Boolean).join(', ') + '.'
      }
      case 'select': {
        const values = Array.isArray(args.values) ? args.values.map(String) : typeof args.value === 'string' ? [args.value] : []
        if (!values.length) throw new ToolError('Missing required argument "values".')
        return driver.select(str(args, 'target'), values)
      }
      case 'scroll':
        return driver.scroll({ target: str(args, 'target', false) || undefined, dx: int(args, 'dx', 0, -20000, 20000), dy: int(args, 'dy', 600, -20000, 20000) })
      case 'wait':
        return driver.waitFor(
          { text: str(args, 'text', false) || undefined, selector: str(args, 'selector', false) || undefined, url: str(args, 'url', false) || undefined, gone: args.gone === true },
          int(args, 'timeout_ms', 10000, 100, 120000)
        )
      case 'evaluate':
        return driver.evaluate(str(args, 'script'))
    }
  }

  private async withSnapshot(pageId: string, driver: PageDriver, message: string, args: Args, byDefault = true): Promise<ToolResult> {
    const wanted = typeof args.snapshot === 'boolean' ? args.snapshot : byDefault
    if (!wanted) return { text: `[page ${pageId}] ${message}` }
    return { text: `[page ${pageId}] ${message}\n\n${await driver.snapshot()}` }
  }

  private async pages(agent: AgentRef, args: Args): Promise<string> {
    const browser = this.browser
    const action = str(args, 'action', false) || 'list'
    if (action === 'new') {
      const p = browser.newAgentPage(agent, undefined, str(args, 'profile', false) || undefined)
      const url = str(args, 'url', false)
      if (url) await p.driver.navigate(url)
      return `Opened page ${p.id}; it is now your current page.${url ? `\n\n${await p.driver.snapshot()}` : ''}`
    }
    if (action === 'select') {
      const p = browser.agentPage(agent, str(args, 'page'))
      return `Page ${p.id} is now your current page.`
    }
    if (action === 'close') {
      const id = str(args, 'page')
      const view = browser.pagesIn(agent.workspaceId).find((p) => p.id === id)
      if (!view) throw new ToolError(`No page "${id}" in your workspace.`)
      if (view.ownerAgentId !== agent.id) throw new ToolError(`Page ${id} is not yours; only the user (or its owner) can close it.`)
      browser.close(id)
      return `Closed page ${id}.`
    }
    const pages = browser.pagesIn(agent.workspaceId)
    if (!pages.length) return 'No pages yet. Any browser_* call opens one for you.'
    return pages
      .map((p) => {
        const owner = p.ownerAgentId === agent.id ? 'yours' : p.ownerName ? `${p.ownerName}'s` : "the user's"
        return `- ${p.id}${browser.isCurrent(agent.id, p.id) ? ' (current)' : ''} · ${owner} · ${JSON.stringify(p.title || 'untitled')} — ${p.url || 'about:blank'}`
      })
      .join('\n')
  }

  private async cookies(agent: AgentRef, pageId: string | undefined, args: Args): Promise<string> {
    const p = this.browser.agentPage(agent, pageId)
    const profileId = this.browser.pageView(p).profileId
    const action = str(args, 'action', false) || 'get'
    const url = args.all === true ? undefined : str(args, 'url', false) || (action === 'get' ? p.view.webContents.getURL() : undefined)
    if (action === 'clear') {
      if (!url && args.all !== true) throw new ToolError('Pass url, or all: true to clear every cookie in the profile.')
      return `Cleared ${await this.browser.clearCookies(profileId, url)} cookie(s).`
    }
    if (action === 'set') {
      const list = Array.isArray(args.cookies) ? (args.cookies as Args[]) : []
      if (!list.length) throw new ToolError('cookies must be a non-empty array.')
      const inputs = list.map((c) => {
        const name = str(c, 'name')
        const domain = str(c, 'domain', false)
        const cookieUrl = str(c, 'url', false) || (domain ? `https://${domain.replace(/^\./, '')}${str(c, 'path', false) || '/'}` : p.view.webContents.getURL())
        return {
          url: cookieUrl,
          name,
          value: typeof c.value === 'string' ? c.value : '',
          ...(domain ? { domain } : {}),
          ...(str(c, 'path', false) ? { path: str(c, 'path') } : {}),
          secure: c.secure === true,
          httpOnly: c.httpOnly === true,
          ...(typeof c.expirationDate === 'number' ? { expirationDate: c.expirationDate } : {}),
          ...(typeof c.sameSite === 'string' ? { sameSite: c.sameSite as 'lax' } : {})
        }
      })
      const { imported, failed } = await this.browser.setCookies(profileId, inputs)
      return `Set ${imported} cookie(s)${failed ? `; ${failed} rejected (check url/domain)` : ''}.`
    }
    const list = await this.browser.cookies(profileId, url && url !== 'about:blank' ? url : undefined)
    if (!list.length) return `No cookies${url ? ` for ${url}` : ''} in profile ${profileId}.`
    return JSON.stringify(
      list.map((c) => ({ name: c.name, value: c.value.length > 300 ? `${c.value.slice(0, 300)}…` : c.value, domain: c.domain, path: c.path, secure: c.secure, httpOnly: c.httpOnly, expirationDate: c.expirationDate, sameSite: c.sameSite })),
      null,
      1
    )
  }
}
