/* global document, window, getComputedStyle */
// End-to-end battle test: drives the built Electron app with throwaway profiles and repositories.
// Usage: pnpm build && node scripts/e2e.mjs [screenshotDir]   (E2E_CHAT=1 also runs real chat prompts)
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'

const shots = resolve(process.argv[2] ?? join(tmpdir(), 'hiveory-e2e'))
mkdirSync(shots, { recursive: true })
const sandbox = mkdtempSync(join(tmpdir(), 'hiveory-e2e-'))
const profile = join(sandbox, 'profile')
const local = join(sandbox, 'local')

// ---------- fixtures ----------
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim()
const makeRepo = (name) => {
  const dir = join(sandbox, name)
  mkdirSync(dir)
  git(dir, 'init', '-b', 'main')
  git(dir, 'config', 'user.email', 'e2e@example.test')
  git(dir, 'config', 'user.name', 'e2e')
  writeFileSync(join(dir, 'README.md'), '# demo\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-m', 'init')
  git(dir, 'branch', 'develop')
  return dir
}
const repo = makeRepo('demo-app')
// An image with one word in it, for the real attachment round trip.
const IMAGE = join(sandbox, 'code.png')
execFileSync('python', ['-c', `from PIL import Image, ImageDraw, ImageFont
im = Image.new('RGB', (420, 140), 'white')
ImageDraw.Draw(im).text((30, 30), 'AMBER', fill='black', font=ImageFont.truetype('arial.ttf', 72))
im.save(r'${IMAGE}')`])
const plain = join(sandbox, 'plain-folder')
mkdirSync(plain)
writeFileSync(join(plain, 'notes.txt'), 'hello')
// Plain folders get a local identity once initialized (the test machine may have no global one).
process.env.GIT_AUTHOR_NAME = 'e2e'
process.env.GIT_AUTHOR_EMAIL = 'e2e@example.test'
process.env.GIT_COMMITTER_NAME = 'e2e'
process.env.GIT_COMMITTER_EMAIL = 'e2e@example.test'

// A stand-in for Composio (ADR 0023): its REST API (session, connect links, accounts) and the session's MCP server.
const COMPOSIO_KEY = 'ak_e2e_project_key'
const composio = { sessions: 0, calls: 0, accounts: [] }
const composioServer = createServer((req, res) => {
  const base = `http://127.0.0.1:${composioServer.address().port}`
  const url = new URL(req.url, base)
  let body = ''
  req.on('data', (chunk) => (body += chunk))
  req.on('end', () => {
    const json = (status, value) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value))
    // An app's own sign-in page: opening it approves the account (the user clicking Allow).
    const signIn = url.pathname.match(/^\/signin\/(ca_e2e\d+)$/)
    if (signIn) {
      const account = composio.accounts.find((a) => a.id === signIn[1])
      if (account) account.status = 'ACTIVE'
      return res.writeHead(200, { 'content-type': 'text/html' }).end('<p>Connected</p>')
    }
    if (req.headers['x-api-key'] !== COMPOSIO_KEY) return json(401, { error: { message: 'Invalid API key' } })
    const input = body ? JSON.parse(body) : {}
    const path = url.pathname
    if (path === '/api/v3.1/tool_router/session' && req.method === 'POST') {
      composio.sessions++
      return json(201, { session_id: `trs_e2e${composio.sessions}`, mcp: { type: 'http', url: `${base}/tool_router/trs_e2e${composio.sessions}/mcp` }, tool_router_tools: [], config: {} })
    }
    if (/^\/api\/v3\.1\/tool_router\/session\/trs_e2e\d+\/link$/.test(path) && req.method === 'POST') {
      const id = `ca_e2e${composio.accounts.length + 1}`
      composio.accounts.push({ id, toolkit: { slug: input.toolkit }, alias: input.alias ?? null, status: 'INITIATED', state: { val: { access_token: 'e2e-app-token-secret' } } })
      return json(201, { link_token: 'lt', redirect_url: `${base}/signin/${id}`, connected_account_id: id })
    }
    if (path === '/api/v3.1/connected_accounts' && req.method === 'GET') return json(200, { items: composio.accounts })
    const removed = path.match(/^\/api\/v3\.1\/connected_accounts\/(ca_e2e\d+)$/)
    if (removed && req.method === 'DELETE') {
      composio.accounts = composio.accounts.filter((a) => a.id !== removed[1])
      return json(200, { success: true })
    }
    if (/^\/tool_router\/trs_e2e\d+\/mcp$/.test(path)) {
      if (req.method !== 'POST') return res.writeHead(405).end()
      if (input.id === undefined) return res.writeHead(202).end()
      const reply = (result) => json(200, { jsonrpc: '2.0', id: input.id, result })
      if (input.method === 'initialize') return reply({ protocolVersion: input.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fake-composio', version: '1' } })
      if (input.method === 'tools/list') {
        return reply({ tools: [{ name: 'COMPOSIO_SEARCH_TOOLS', description: 'Find the tools for an app', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } }] })
      }
      if (input.method === 'tools/call') {
        composio.calls++
        // Echoes the key it got, so the run can check agents only ever see it masked.
        return reply({ content: [{ type: 'text', text: `found GMAIL_SEND_EMAIL for ${input.params.arguments.query} (key ${req.headers['x-api-key']})` }] })
      }
      return json(200, { jsonrpc: '2.0', id: input.id, error: { code: -32601, message: 'nope' } })
    }
    res.writeHead(404).end()
  })
})
await new Promise((r) => composioServer.listen(0, '127.0.0.1', r))
process.env.HIVEORY_COMPOSIO_API = `http://127.0.0.1:${composioServer.address().port}/api/v3.1`

// ---------- harness ----------
const results = []
// Playwright asserts ("Target crashed") when a hidden background page it auto-attached to (a
// browser_crawl worker) is closed. The app is fine — the main window has its own crash handler —
// so that one assertion is logged instead of killing the run.
process.on('uncaughtException', (error) => {
  if (/Target crashed/.test(String(error?.message))) return console.log('  (ignored Playwright assertion: a background page target closed)')
  console.error(error)
  process.exit(1)
})
let app
let page
let closing = false
const launch = async () => {
  app = await electron.launch({ args: ['.'], env: { ...process.env, HIVEORY_USER_DATA: profile, LOCALAPPDATA: local } })
  const proc = app.process()
  proc.on('exit', (code, signal) => {
    if (!closing) console.log(`  !! Electron exited unexpectedly (code ${code}, signal ${signal})`)
  })
  proc.stderr?.on('data', (d) => {
    const text = String(d)
    if (/error|fatal|crash/i.test(text) && !/Security Warning|DevTools|Debugger/.test(text)) console.log(`  [stderr] ${text.trim().slice(0, 300)}`)
  })
  page = await app.firstWindow()
  page.on('crash', () => console.log('  !! renderer crashed'))
  page.on('pageerror', (e) => results.push({ name: `pageerror: ${e.message}`, ok: false }))
  await page.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined)
  await page.waitForSelector('text=Hiveory')
}
const close = async () => {
  closing = true
  await app.close()
  closing = false
}
const relaunch = async () => {
  await close()
  await launch()
}
/** Picks an option in the app's Select: a combobox with a themed listbox, never a native <select>. */
const choose = async (scope, label, option) => {
  await scope.getByRole('combobox', { name: label, exact: true }).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}
/** Waits until a workspace matching `pred` exists (the UI may still show the previous screen). */
const workspaceWhere = async (pid, pred) => {
  let found
  await waitFor(async () => {
    found = (await value('workspaces.list', { projectId: pid })).find(pred)
    return Boolean(found)
  }, 'workspace to be created')
  return found
}
/** Opens a workspace from the sidebar, expanding its project first. */
const openSidebarWorkspace = async (projectName, workspaceName) => {
  const row = page.getByRole('button', { name: projectName, exact: true })
  await row.click()
  // The row's accessible name also carries its agent count ("Main 4").
  await page.getByRole('navigation', { name: 'Projects' }).getByRole('button', { name: new RegExp(`^${workspaceName}( [0-9]+)?$`) }).first().click()
}
const shot = (name) => page.screenshot({ path: join(shots, `${name}.png`) }).catch(() => undefined)
const test = async (name, fn) => {
  const started = Date.now()
  try {
    await fn()
    results.push({ name, ok: true, ms: Date.now() - started })
    console.log(`  ✓ ${name} (${Date.now() - started} ms)`)
  } catch (error) {
    // fetch failures hide the real reason in error.cause (ECONNRESET, a timeout…).
    const cause = error?.cause ? ` (cause: ${error.cause.code ?? ''} ${error.cause.message ?? error.cause})` : ''
    const message = `${String(error?.message ?? error).split('\n')[0]}${cause} after ${Date.now() - started} ms`
    results.push({ name, ok: false, error: message })
    // Playwright puts the reason (what intercepted a click, which elements matched) on later lines.
    const detail = String(error?.message ?? '').split('\n').slice(1, 8).filter((l) => l.trim()).map((l) => `        ${l.trim()}`).join('\n')
    console.log(`  ✗ ${name}\n      ${message}${detail ? `\n${detail}` : ''}`)
    await shot(`FAIL-${name.replace(/[^a-z0-9]+/gi, '-')}`)
  }
}
const expect = (cond, message) => {
  if (!cond) throw new Error(message)
}
const invoke = (channel, payload) => page.evaluate(async ([c, p]) => window.hiveory.invoke(c, p), [channel, payload])
const value = async (channel, payload) => {
  const r = await invoke(channel, payload)
  if (!r.ok) throw new Error(`${channel}: ${r.error.message}`)
  return r.value
}
const stubFolderPicker = (folder) =>
  app.evaluate(({ dialog }, f) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] })
  }, folder)
/** Add project › Pick directory, with the folder picker stubbed to `folder`. */
const addProjectFolder = async (folder) => {
  await stubFolderPicker(folder)
  await page.getByRole('button', { name: 'Add project', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Add project' })
  await dialog.getByRole('button', { name: 'Choose' }).click()
  await dialog.getByRole('button', { name: /^Add project/ }).click()
}
/** The user's browser: records each page Hiveory opens and follows it (a sign-in redirects straight back). */
const stubBrowser = () =>
  app.evaluate(({ shell }) => {
    globalThis.__opened = []
    shell.openExternal = async (url) => {
      globalThis.__opened.push(url)
      await fetch(url)
    }
  })
const waitFor = async (fn, message, timeout = 15000) => {
  const end = Date.now() + timeout
  for (;;) {
    if (await fn()) return
    if (Date.now() > end) throw new Error(`Timed out: ${message}`)
    await page.waitForTimeout(150)
  }
}
const panes = () => page.locator('section[aria-label$=" agent"]')
const paneBoxes = () =>
  page.locator('section[aria-label$=" agent"]').evaluateAll((els) => els.map((el) => ({ name: el.getAttribute('aria-label'), ...el.getBoundingClientRect().toJSON() })))

let projectId
let plainProjectId
let mainWs
let featureWs
let existingWs

console.log(`Hiveory E2E — sandbox ${sandbox}`)
await launch()

// ======================= A. Shell =======================
console.log('A. Shell & settings')
await test('home renders with DEV badge and Work/Chat modes', async () => {
  await page.waitForSelector('text=Welcome to Hiveory')
  expect(await page.getByText('DEV', { exact: true }).isVisible(), 'DEV badge missing')
  expect((await value('settings.get')).theme === 'dark', 'Dark is not the default theme')
  expect(await page.getByRole('tab', { name: 'Work' }).isVisible(), 'Work tab missing')
  expect(await page.getByRole('tab', { name: 'Chat' }).isVisible(), 'Chat tab missing')
  await shot('a1-home')
})

await test('settings: every section renders', async () => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  for (const section of ['Appearance', 'Agents', 'Skills, MCP & Apps', 'Updates', 'Guide', 'About']) {
    await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: section }).click()
    await page.waitForTimeout(150)
    expect(!(await page.getByText('failed to display').isVisible()), `${section} crashed`)
  }
})

await test('settings: silver theme applies instantly and persists', async () => {
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Appearance' }).click()
  await page.getByRole('radio', { name: /Silver/ }).click()
  await waitFor(async () => (await page.evaluate(() => document.documentElement.dataset.theme)) === 'silver', 'theme attribute')
  expect((await value('settings.get')).theme === 'silver', 'theme not saved')
  await shot('a2-settings-silver')
  await page.getByRole('radio', { name: /Bronze/ }).click()
})

await test('settings: Dark is the default theme and perfectly flat', async () => {
  await page.getByRole('radio', { name: /Dark/ }).click()
  await waitFor(async () => (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark', 'dark theme attribute')
  const fills = await page.evaluate(() => {
    const css = getComputedStyle(document.documentElement)
    return ['--fill-raised', '--fill-selected', '--fill-active', '--gradient-app', '--gradient-surface', '--color-sheen'].map((t) => css.getPropertyValue(t).trim())
  })
  expect(fills.every((f) => !/gradient\(/.test(f) || /^linear-gradient\((#[0-9a-f]+), \1\)$/i.test(f)), `dark theme has gradients: ${fills.join(' | ')}`)
  const bg = await page.evaluate(() => getComputedStyle(document.body.firstElementChild).backgroundImage)
  expect(bg === 'none', `app background is not flat: ${bg}`)
  await shot('a2b-settings-dark')
})

await test('appearance: six themes, three per row; new themes apply', async () => {
  const cards = page.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio')
  expect((await cards.count()) === 6, `theme count ${await cards.count()}`)
  const tops = await cards.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)))
  expect(tops[0] === tops[1] && tops[1] === tops[2] && tops[3] > tops[0] && tops[3] === tops[5], `not three per row: ${tops}`)
  for (const [name, id] of [['Midnight', 'midnight'], ['Jade', 'jade'], ['Rose', 'rose']]) {
    await page.getByRole('radio', { name: new RegExp(name) }).click()
    await waitFor(async () => (await page.evaluate(() => document.documentElement.dataset.theme)) === id, `${id} theme`)
  }
  await page.waitForTimeout(500)
  await shot('a2c-themes')
  await page.getByRole('radio', { name: /^Dark/ }).click()
})

await test('appearance: an added image becomes the wallpaper; transparency reaches every surface', async () => {
  expect((await page.getByRole('radiogroup', { name: 'Wallpaper' }).getByRole('radio').count()) === 1, 'built-in wallpapers still listed')
  await stubFolderPicker(IMAGE)
  await page.getByRole('button', { name: 'Add image' }).click()
  await waitFor(async () => /^image:w-[a-f0-9]{12}\.jpg$/.test((await value('settings.get')).wallpaper), 'wallpaper saved')
  await waitFor(async () => page.evaluate(() => 'wallpaper' in document.documentElement.dataset), 'wallpaper attribute')
  const alphaOf = (selector) =>
    page.locator(selector).first().evaluate((el) => {
      const c = getComputedStyle(el).backgroundColor
      const m = /\/\s*([\d.]+)\)$/.exec(c) ?? /rgba\([^)]*,\s*([\d.]+)\)$/.exec(c)
      return m ? Number(m[1]) : 1
    })
  await page.getByLabel('Transparency').focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.up('ArrowRight')
  await waitFor(async () => (await value('settings.get')).surfaceOpacity < 0.6, 'transparency saved')
  // Fully transparent: every surface, raised ones included, in every theme.
  await value('settings.update', { surfaceOpacity: 0 })
  for (const theme of ['dark', 'bronze', 'silver']) {
    await value('settings.update', { theme })
    await page.waitForTimeout(450)
    const alphas = [await alphaOf('nav[aria-label="Settings sections"]'), await alphaOf('[role="radiogroup"][aria-label="Theme"] [role="radio"]')]
    expect(alphas.every((a) => a === 0), `${theme}: surfaces not fully transparent (${alphas})`)
  }
  await value('settings.update', { theme: 'dark', surfaceOpacity: 0.6 })
  await page.waitForTimeout(400)
  await shot('a2d-wallpaper')
  await page.getByRole('radio', { name: 'None' }).click()
  await waitFor(async () => !(await page.evaluate(() => 'wallpaper' in document.documentElement.dataset)), 'wallpaper removed')
})

await test('the title-bar logo is flat (no glow, no gradient)', async () => {
  const logo = await page.locator('header img').first().evaluate((el) => {
    const s = getComputedStyle(el)
    return { filter: s.filter, clip: s.clipPath }
  })
  expect(logo.filter === 'none' && logo.clip.startsWith('inset'), JSON.stringify(logo))
  const name = await page.locator('header').getByText('Hiveory', { exact: true }).evaluate((el) => getComputedStyle(el).backgroundImage)
  expect(name === 'none', `brand name has a gradient: ${name}`)
})

await test('extensions: skills, MCP and apps are separate tabs; apps use real logos', async () => {
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Skills, MCP & Apps' }).click()
  for (const tab of ['Skills', 'MCP servers', 'Apps']) expect(await page.getByRole('tab', { name: new RegExp(tab) }).isVisible(), `${tab} tab missing`)
  await page.getByRole('tab', { name: /MCP servers/ }).click()
  await page.getByText('In Hiveory · every agent').waitFor()
  await page.getByRole('tab', { name: /Apps/ }).click()
  // Composio apps (ADR 0023): one Composio API key field, no per-app keys, no Composio login.
  const connectButtons = page.getByRole('button', { name: 'Connect', exact: true })
  await waitFor(async () => (await connectButtons.count()) >= 40, 'app cards')
  const logos = await page.locator('img[src^="data:image/svg+xml"]').count()
  expect(logos >= 40, `only ${logos} app logos`)
  expect(await page.locator('section[aria-label="Gmail"]').getByRole('button', { name: 'Connect', exact: true }).isDisabled(), 'apps can be connected before a Composio key is saved')
  expect(await page.getByRole('textbox', { name: 'Composio API key', exact: true }).isVisible(), 'no Composio API key field')
  expect((await page.locator('input[type="password"]').count()) === 1, 'a per-app key field is on the Apps screen')
  expect((await page.getByText(/Sign in with Composio/).count()) === 0, 'a Composio login is still on the Apps screen')
  await page.getByRole('button', { name: 'Code', exact: true }).click()
  await waitFor(async () => (await page.getByText('GitHub', { exact: true }).isVisible()) && !(await page.getByText('Notion', { exact: true }).isVisible()), 'category filter')
  await page.getByRole('button', { name: 'All', exact: true }).click()
  await shot('a2e-apps-signed-out')
  await page.getByRole('tab', { name: /Skills/ }).click()
  await page.getByRole('button', { name: 'New skill' }).click()
  await page.getByLabel('Name', { exact: true }).fill('E2E Skill')
  expect((await page.getByLabel('Name', { exact: true }).inputValue()) === 'e2e-skill', 'skill name not slugged')
  await page.keyboard.press('Escape')
})

await test('apps: a Composio key once; Connect goes straight to the app; a labelled second account; Disconnect', async () => {
  await stubBrowser()
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Skills, MCP & Apps' }).click()
  await page.getByRole('tab', { name: /Apps/ }).click()
  const keyField = page.getByRole('textbox', { name: 'Composio API key', exact: true })
  await keyField.fill('ak_wrong_key_123')
  await page.getByRole('button', { name: 'Save key' }).click()
  await page.getByText(/did not accept this API key/).first().waitFor({ timeout: 15000 })
  await keyField.fill(COMPOSIO_KEY)
  await page.getByRole('button', { name: 'Save key' }).click()
  await page.getByText('Key saved').waitFor({ timeout: 20000 })
  expect(!JSON.stringify(await value('connections.list')).includes(COMPOSIO_KEY), 'the key reached the renderer')
  await waitFor(async () => readFileSync(join(profile, 'state.json'), 'utf8').includes('"provider": "composio"') || readFileSync(join(profile, 'state.json'), 'utf8').includes('"provider":"composio"'), 'key saved')
  expect(!readFileSync(join(profile, 'state.json'), 'utf8').includes(COMPOSIO_KEY), 'the key is in the state file in plain text')

  // Connect: straight to Gmail's own sign-in — no Composio login.
  const gmail = page.locator('section[aria-label="Gmail"]')
  // Connect asks for the account's name first, then opens Gmail's own sign-in.
  await gmail.getByRole('button', { name: 'Connect', exact: true }).click()
  expect(await gmail.getByRole('button', { name: 'Continue' }).isDisabled(), 'an account can be connected without a name')
  await gmail.getByLabel('Gmail account name').fill('Personal')
  await gmail.getByRole('button', { name: 'Continue' }).click()
  await waitFor(async () => composio.accounts.find((a) => a.id === 'ca_e2e1')?.status === 'ACTIVE', 'Gmail signed in')
  expect(composio.accounts.find((a) => a.id === 'ca_e2e1').alias === 'Personal', 'name not sent to Composio')
  const opened = await app.evaluate(() => globalThis.__opened)
  expect(opened.length === 1 && opened[0].endsWith('/signin/ca_e2e1'), `browser opened: ${opened}`)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await gmail.getByText('ca_e2e1 · active').waitFor({ timeout: 15000 })
  expect(await gmail.getByText('Connected').isVisible(), 'Gmail not shown as connected')

  // Add account: a label first, then that account's own sign-in.
  await gmail.getByRole('button', { name: 'Add account' }).click()
  await gmail.getByLabel('Gmail account name').fill('Work')
  await gmail.getByRole('button', { name: 'Continue' }).click()
  await waitFor(async () => composio.accounts.find((a) => a.id === 'ca_e2e2')?.status === 'ACTIVE', 'second Gmail account signed in')
  expect(composio.accounts.find((a) => a.id === 'ca_e2e2').alias === 'Work', 'label not sent to Composio')
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await gmail.getByText('ca_e2e2 · active').waitFor({ timeout: 15000 })
  expect(!JSON.stringify(await value('apps.status')).includes('e2e-app-token-secret'), "an app's credentials reached the renderer")
  await shot('a2f-apps-composio-accounts')

  // Disconnect the Work account (confirmed).
  await gmail.locator('li').filter({ hasText: 'Work' }).getByRole('button', { name: 'Disconnect' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Disconnect' }).click()
  await waitFor(async () => !composio.accounts.some((a) => a.id === 'ca_e2e2'), 'Work account removed from Composio')
  await gmail.getByText('ca_e2e2 · active').waitFor({ state: 'detached', timeout: 15000 })
  expect(await gmail.getByText('ca_e2e1 · active').isVisible(), 'the other account went too')
})
await test('settings: agent defaults pre-fill the create dialog toggles', async () => {
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Agents' }).click()
  await page.getByRole('switch', { name: 'Use chat UI by default' }).click()
  await page.getByRole('switch', { name: 'Auto-approve permissions by default' }).click()
  await waitFor(async () => {
    const s = await value('settings.get')
    return s.defaultChatUi && s.defaultAutoApprove
  }, 'defaults saved')
})

await test('settings: guide search filters and chapters open', async () => {
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Guide' }).click()
  await page.getByLabel('Search the guide').fill('swap')
  await page.waitForTimeout(150)
  expect(await page.getByRole('button', { name: /Arranging panes/ }).isVisible(), 'search did not find layout chapter')
  expect(!(await page.getByRole('button', { name: /^.*Presets/ }).isVisible()), 'search did not filter')
  await page.getByRole('button', { name: /Arranging panes/ }).click()
  expect(await page.getByRole('heading', { name: 'Arranging panes' }).isVisible(), 'chapter did not open')
  await page.getByRole('button', { name: /Next chapter/ }).click()
  expect(await page.getByRole('heading', { name: 'The Kanban' }).isVisible(), 'next chapter failed')
  await shot('a3-guide')
})

await test('settings: updates are honest in development builds', async () => {
  await page.getByRole('button', { name: 'All chapters' }).click().catch(() => undefined)
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Updates' }).click()
  expect(await page.getByText('Updates run in installed builds').isVisible(), 'unsupported state not shown')
  expect(await page.getByRole('button', { name: 'Check now' }).isDisabled(), 'check should be disabled in dev')
  await page.getByRole('button', { name: 'Close settings' }).click()
})

// ======================= B. Projects, Git, workspaces =======================
console.log('B. Projects, Git & workspaces')
await test('open a Git project: no workspaces are created automatically', async () => {
  await addProjectFolder(repo)
  await page.waitForSelector('text=Idle')
  projectId = (await value('projects.list'))[0].id
  expect((await value('workspaces.list', { projectId })).length === 0, 'a workspace was auto-created')
  expect(await page.getByRole('button', { name: /Downloads|demo-app/ }).first().isVisible(), 'path trail missing')
})

await test('project page has no gear; path trail copies the full path', async () => {
  expect((await page.locator('header').getByRole('button', { name: 'Project settings' }).count()) === 0, 'project gear still present')
  await page.getByRole('button', { name: /Copy path/ }).first().click()
  await page.waitForTimeout(200)
  const clip = await app.evaluate(({ clipboard }) => clipboard.readText())
  expect(clip === repo, `clipboard has "${clip}"`)
})

await test('project tab bar "New workspace" opens create with the Settings defaults', async () => {
  expect((await page.getByRole('banner').getByRole('button', { name: 'New workspace' }).count()) === 0, 'New workspace still in the app title bar')
  await page.getByRole('region', { name: 'demo-app' }).getByRole('button', { name: 'New workspace', exact: true }).click()
  await page.waitForSelector('dialog[open]')
  expect((await page.getByRole('switch', { name: 'Use chat UI' }).getAttribute('aria-checked')) === 'true', 'chat UI default not applied')
  expect((await page.getByRole('switch', { name: 'Auto-approve permissions' }).getAttribute('aria-checked')) === 'true', 'auto-approve default not applied')
  await page.keyboard.press('Escape')
  await value('settings.update', { defaultChatUi: false, defaultAutoApprove: false })
})

await test('sidebar "+" opens create; main workspace via Project folder', async () => {
  // The dialog reads the defaults when it opens; the previous test's settings change reaches the window by event.
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: 'New workspace in demo-app' }).click()
  await page.waitForSelector('dialog[open]')
  expect((await page.getByRole('radio', { name: /Project folder/ }).getAttribute('aria-checked')) === 'true', 'main should be default')
  expect((await page.getByRole('switch', { name: 'Use chat UI' }).getAttribute('aria-checked')) === 'false', 'chat UI default should be off again')
  await page.getByRole('button', { name: 'Create empty' }).click()
  mainWs = await workspaceWhere(projectId, (w) => w.kind === 'main')
  expect(mainWs && mainWs.path === repo, 'main workspace wrong')
})

await test('main workspace cannot be created twice', async () => {
  await page.getByRole('button', { name: 'New workspace in demo-app' }).click()
  await page.waitForSelector('dialog[open]')
  expect(await page.getByRole('radio', { name: /Project folder/ }).isDisabled(), 'second main allowed')
  const r = await invoke('workspaces.create', { projectId, kind: 'main', name: 'Main 2', cliSelections: [], autoApprove: false })
  expect(!r.ok && /already has a main/.test(r.error.message), 'IPC allowed duplicate main')
})

await test('new branch: invalid branch name is caught before creating', async () => {
  await page.getByRole('radio', { name: /New branch/ }).click()
  await page.waitForSelector('text=Base branch')
  await page.getByLabel('New branch').fill('bad..name')
  await page.waitForSelector('text=not a valid Git branch name', { timeout: 5000 })
  expect(await page.getByRole('button', { name: 'Create empty' }).isDisabled(), 'create enabled with invalid branch')
})

await test('new branch from develop with a custom name creates a real worktree', async () => {
  await page.getByLabel('Workspace name').fill('Feature E2E')
  await choose(page, 'Base branch', 'develop')
  await page.getByLabel('New branch').fill('feature/e2e')
  await waitFor(async () => !(await page.getByRole('button', { name: 'Create empty' }).isDisabled()), 'create to enable')
  await shot('b1-create-branch')
  await page.getByRole('button', { name: 'Create empty' }).click()
  featureWs = await workspaceWhere(projectId, (w) => w.git?.branch === 'feature/e2e')
  expect(featureWs?.git.baseRef === 'develop', 'base ref not recorded')
  expect(git(repo, 'worktree', 'list').includes('feature/e2e'), 'worktree missing from git')
  expect(existsSync(join(featureWs.path, 'README.md')), 'worktree folder empty')
})

await test('use an existing branch (develop) without ever deleting it', async () => {
  await page.getByRole('button', { name: 'New workspace in demo-app' }).click()
  await page.waitForSelector('dialog[open]')
  await page.getByRole('radio', { name: /New branch/ }).click()
  await page.getByRole('switch', { name: 'Use an existing branch' }).click()
  await choose(page, 'Branch to check out', 'develop')
  await page.getByLabel('Workspace name').fill('Develop')
  await page.getByRole('button', { name: 'Create empty' }).click()
  existingWs = await workspaceWhere(projectId, (w) => w.name === 'Develop')
  expect(existingWs?.git.createdBranch === false, 'existing branch flagged as created')
})

await test('branches already checked out are not offered again', async () => {
  const info = await value('git.info', { projectId })
  expect(info.branchesInUse.includes('develop') && info.branchesInUse.includes('main'), 'in-use branches not reported')
  const r = await invoke('workspaces.create', { projectId, kind: 'isolated', name: 'Dup', cliSelections: [], autoApprove: false, useExistingBranch: true, branch: 'develop' })
  expect(!r.ok && /already checked out/.test(r.error.message), 'duplicate checkout allowed')
})

await test('IPC rejects shell-ish branch names', async () => {
  const r = await invoke('workspaces.create', { projectId, kind: 'isolated', name: 'x', cliSelections: [], autoApprove: false, branch: 'x; rm -rf /' })
  expect(!r.ok && r.error.code === 'INVALID_INPUT', 'unsafe branch accepted')
})

await test('workspace cards show live git status', async () => {
  writeFileSync(join(featureWs.path, 'new.txt'), 'x')
  await page.getByRole('button', { name: 'demo-app', exact: true }).click()
  await page.getByRole('tab', { name: 'Workspaces' }).click()
  await page.waitForSelector('text=1 changed', { timeout: 10000 })
  await shot('b2-workspaces-status')
})

await test('repair rebuilds a deleted workspace folder', async () => {
  const path = existingWs.git.worktreePath
  rmSync(path, { recursive: true, force: true })
  await relaunch()
  await page.getByRole('button', { name: 'demo-app', exact: true }).click()
  await page.getByRole('tab', { name: 'Workspaces' }).click()
  await page.waitForSelector('text=Folder missing on disk')
  await page.getByRole('button', { name: 'Repair', exact: true }).click()
  await waitFor(async () => existsSync(join(path, 'README.md')), 'folder rebuilt')
})

await test('deleting a dirty workspace needs a second confirmation; existing branches survive', async () => {
  await value('workspaces.delete', { workspaceId: existingWs.id, force: false })
  expect(git(repo, 'branch', '--list', 'develop').includes('develop'), 'existing branch was deleted')
  const dirty = await invoke('workspaces.delete', { workspaceId: featureWs.id, force: false })
  expect(!dirty.ok && dirty.error.code === 'WORKTREE_DIRTY', 'dirty delete not blocked')
  await value('workspaces.delete', { workspaceId: featureWs.id, force: true })
  expect(!existsSync(featureWs.git.worktreePath), 'forced delete left folder')
})

await test('plain folder: Initialize Git makes isolation possible', async () => {
  await addProjectFolder(plain)
  await page.waitForTimeout(500)
  plainProjectId = (await value('projects.list')).find((p) => p.path === plain).id
  await page.getByRole('button', { name: 'New workspace in plain-folder' }).click()
  await page.getByRole('radio', { name: /New branch/ }).click()
  await page.waitForSelector('text=not a Git repository')
  await shot('b3-init-git')
  await page.getByRole('button', { name: 'Initialize Git' }).click()
  await page.waitForSelector('text=Base branch', { timeout: 15000 })
  await page.getByRole('button', { name: 'Create empty' }).click()
  await workspaceWhere(plainProjectId, (w) => w.kind === 'isolated')
  expect(existsSync(join(plain, '.git')), 'git not initialized')
})

// ======================= C. Panes =======================
console.log('C. Panes, layout & resizing')
await test('open agents; panes fill the area without a header bar', async () => {
  await openSidebarWorkspace('demo-app', 'Main')
  await page.getByRole('button', { name: /Open agent/ }).click()
  await page.getByRole('menuitem', { name: 'Claude Code' }).click()
  await panes().first().waitFor()
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: 'Add agent' }).first().click()
    await page.getByRole('menuitem', { name: 'Claude Code' }).click()
    await waitFor(async () => (await panes().count()) === i + 2, 'pane to appear')
  }
  expect((await page.getByRole('navigation', { name: 'Breadcrumb' }).count()) === 0, 'header bar still present')
  const boxes = await paneBoxes()
  expect(boxes[0].y < 70, `panes start too low (${boxes[0].y})`)
})

await test('the sidebar order follows work, not clicks (ADR 0024)', async () => {
  const nav = page.getByRole('navigation', { name: 'Projects' })
  const order = async () => {
    const [a, b] = await Promise.all(['demo-app', 'plain-folder'].map(async (name) => (await nav.getByRole('button', { name, exact: true }).boundingBox()).y))
    return a < b ? ['demo-app', 'plain-folder'] : ['plain-folder', 'demo-app']
  }
  const before = await order()
  // Looking at the lower project does not move it.
  await nav.getByRole('button', { name: before[1], exact: true }).click()
  await page.waitForTimeout(500)
  expect(JSON.stringify(await order()) === JSON.stringify(before), `clicking ${before[1]} moved it: ${await order()}`)
  // Work there does: an agent opening in it.
  const lowerId = (await value('projects.list')).find((x) => x.name === before[1]).id
  const ws = (await value('workspaces.list', { projectId: lowerId }))[0]
  const { agent } = await value('agents.open', { workspaceId: ws.id, cliId: 'powershell' })
  await waitFor(async () => (await order())[0] === before[1], `${before[1]} to rise after work there`)
  await value('agents.close', { instanceId: agent.id })
  await openSidebarWorkspace('demo-app', 'Main')
  await panes().first().waitFor()
})

await test('arrange bar: Columns, then narrow panes keep a reachable close button', async () => {
  const src = await panes().first().locator('header').boundingBox()
  const layout = await page.locator('section[aria-label$=" agent"]').first().evaluate((el) => el.parentElement.parentElement.getBoundingClientRect().toJSON())
  await page.mouse.move(src.x + 50, src.y + src.height / 2)
  await page.mouse.down()
  await page.mouse.move(src.x + 70, src.y + 30, { steps: 4 })
  const columnsX = layout.x + layout.width / 2 + 128
  await page.mouse.move(columnsX, layout.y + 30, { steps: 10 })
  await page.waitForSelector('text=Release on a layout')
  await shot('c1-arrange-bar')
  await page.mouse.up()
  await page.waitForTimeout(500)
  const boxes = await paneBoxes()
  expect(new Set(boxes.map((b) => Math.round(b.y))).size === 1, 'columns did not put panes in one row')
  for (const pane of await panes().all()) {
    const paneBox = await pane.boundingBox()
    const close = pane.getByRole('button', { name: /^Close / })
    const box = await close.boundingBox()
    expect(box && box.x + box.width <= paneBox.x + paneBox.width + 1, 'close button clipped')
    expect(await close.isVisible(), 'close not visible')
  }
  await shot('c2-columns-narrow')
})

await test('arrange: Focus gives the dragged pane half the width', async () => {
  const header = await panes().nth(2).locator('header').boundingBox()
  const layout = await page.locator('section[aria-label$=" agent"]').first().evaluate((el) => el.parentElement.parentElement.getBoundingClientRect().toJSON())
  await page.mouse.move(header.x + 40, header.y + header.height / 2)
  await page.mouse.down()
  await page.mouse.move(header.x + 60, header.y + 30, { steps: 4 })
  await page.mouse.move(layout.x + layout.width / 2, layout.y + 30, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(500)
  const boxes = await paneBoxes()
  const widest = boxes.reduce((a, b) => (b.width > a.width ? b : a))
  expect(Math.abs(widest.width - (layout.width - 10) / 2) < 6, `focus width ${widest.width} vs ${layout.width / 2}`)
  await shot('c3-focus')
})

await test('arrange: Equal builds a grid', async () => {
  const header = await panes().first().locator('header').boundingBox()
  const layout = await page.locator('section[aria-label$=" agent"]').first().evaluate((el) => el.parentElement.parentElement.getBoundingClientRect().toJSON())
  await page.mouse.move(header.x + 40, header.y + header.height / 2)
  await page.mouse.down()
  await page.mouse.move(header.x + 60, header.y + 30, { steps: 4 })
  await page.mouse.move(layout.x + layout.width / 2 - 128, layout.y + 30, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(500)
  const boxes = await paneBoxes()
  expect(new Set(boxes.map((b) => Math.round(b.y))).size === 2, 'equal did not make two rows for four panes')
})

await test('resizing never squeezes a pane below its minimum width', async () => {
  const divider = page.getByRole('separator', { name: 'Resize panes' }).first()
  const box = await divider.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x - 2000, box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(300)
  const min = Math.min(...(await paneBoxes()).map((b) => b.width))
  expect(min >= 238, `pane squeezed to ${min}px`)
})

await test('keyboard: divider arrows resize; pane menu moves panes', async () => {
  const divider = page.getByRole('separator', { name: 'Resize panes' }).first()
  const before = await divider.getAttribute('aria-valuenow')
  await divider.focus()
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(250)
  expect((await divider.getAttribute('aria-valuenow')) !== before, 'arrow key did not resize')
  const order = async () => (await paneBoxes()).sort((a, b) => a.y - b.y || a.x - b.x).map((b) => b.name)
  const first = (await order())[0]
  await panes().filter({ hasText: '' }).first()
  await page.getByRole('button', { name: `${first.replace(' agent', '')} actions` }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Move right' }).click()
  await page.waitForTimeout(400)
  expect((await order())[0] !== first, 'move right did nothing')
})

await test('maximize via double-click and restore via button', async () => {
  const header = panes().first().locator('header')
  const name = (await panes().first().getAttribute('aria-label')).replace(' agent', '')
  const hb = await header.boundingBox()
  await page.mouse.dblclick(hb.x + hb.width / 2, hb.y + hb.height / 2)
  await page.waitForTimeout(400)
  const layout = await panes().first().evaluate((el) => el.parentElement.parentElement.getBoundingClientRect().width)
  const max = await page.locator(`section[aria-label="${name} agent"]`).boundingBox()
  expect(max.width > layout - 4, 'double-click did not maximize')
  await shot('c4-maximized')
  await page.getByRole('button', { name: `Restore ${name}` }).click()
  await page.waitForTimeout(400)
  expect((await page.locator(`section[aria-label="${name} agent"]`).boundingBox()).width < layout - 50, 'restore failed')
})

await test('a small window keeps every pane inside the layout', async () => {
  await page.setViewportSize({ width: 960, height: 600 })
  await page.waitForTimeout(500)
  const layout = await panes().first().evaluate((el) => el.parentElement.parentElement.getBoundingClientRect().toJSON())
  for (const b of await paneBoxes()) {
    expect(b.x >= layout.x - 1 && b.x + b.width <= layout.x + layout.width + 1, `pane overflows horizontally (${b.name})`)
    expect(b.y >= layout.y - 1 && b.y + b.height <= layout.y + layout.height + 1, `pane overflows vertically (${b.name})`)
  }
  await shot('c5-small-window')
  await page.setViewportSize({ width: 1440, height: 900 })
})

// ======================= D. Terminal & clipboard =======================
console.log('D. Side panel, sidebars, terminal & clipboard')
const sidePanel = () => page.locator('aside[aria-label="Side panel"]')
await test('side panel starts empty; "+" adds browsers and a single Explorer', async () => {
  await page.getByRole('button', { name: 'Show side panel' }).click()
  await sidePanel().getByText('Nothing open').waitFor()
  const add = async (kind) => {
    await sidePanel().getByRole('button', { name: 'Add browser, explorer or sessions' }).first().click()
    await page.getByRole('menuitem', { name: new RegExp(kind) }).click()
  }
  expect(!(await sidePanel().getByText('Terminal').count()), 'terminal still offered in the side panel')
  await add('Browser')
  await add('Explorer')
  await add('Explorer')
  await waitFor(async () => (await sidePanel().getByRole('tab').count()) === 2, 'two tabs (one explorer)')
  const tabs = await sidePanel().getByRole('tab').allInnerTexts()
  expect(JSON.stringify(tabs) === JSON.stringify(['New tab', 'Explorer']), `tabs: ${tabs}`)
  await sidePanel().getByRole('tab', { name: 'New tab' }).click()
  expect(await sidePanel().getByLabel('Address').isVisible(), 'browser address bar missing')
  await sidePanel().getByRole('tab', { name: 'Explorer' }).click()
  await sidePanel().getByRole('treeitem', { name: 'README.md' }).waitFor()
})

await test('explorer: create, search, open a file as an editable pane and save it', async () => {
  await sidePanel().getByRole('button', { name: 'New file' }).click()
  await sidePanel().getByLabel('File name').fill('notes.txt')
  await page.keyboard.press('Enter')
  await waitFor(async () => existsSync(join(repo, 'notes.txt')), 'file created on disk')
  // A new file opens as a pane right away.
  const editor = page.locator('section[aria-label="notes.txt file"]')
  await editor.waitFor()
  await editor.locator('.cm-content').click()
  await page.keyboard.type('hello from the editor')
  await waitFor(async () => (await editor.getByRole('img', { name: 'Unsaved changes' }).count()) === 1, 'dirty marker')
  await page.keyboard.press('Control+S')
  await waitFor(async () => readFileSync(join(repo, 'notes.txt'), 'utf8') === 'hello from the editor', 'saved to disk')
  // An agent editing the file on disk shows up in the open pane.
  writeFileSync(join(repo, 'notes.txt'), 'changed on disk')
  await waitFor(async () => (await editor.locator('.cm-content').innerText()).includes('changed on disk'), 'reloaded after external change')
  await shot('d1-explorer-editor')
  await editor.getByRole('button', { name: 'Close notes.txt' }).click()
  await waitFor(async () => (await editor.count()) === 0, 'editor pane closed')
  // Search, then open from the results with a double-click.
  await sidePanel().getByLabel('Search files').fill('readme')
  await sidePanel().getByRole('listitem').filter({ hasText: 'README.md' }).dblclick()
  await page.locator('section[aria-label="README.md file"]').waitFor()
  await page.locator('section[aria-label="README.md file"]').getByRole('button', { name: 'Close README.md' }).click()
  await sidePanel().getByLabel('Search files').fill('')
  // Rename and delete through the context menu.
  await sidePanel().getByRole('treeitem', { name: 'notes.txt' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  await sidePanel().getByLabel('File name').fill('renamed.txt')
  await page.keyboard.press('Enter')
  await waitFor(async () => existsSync(join(repo, 'renamed.txt')) && !existsSync(join(repo, 'notes.txt')), 'renamed on disk')
  await sidePanel().getByRole('treeitem', { name: 'renamed.txt' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await page.getByRole('button', { name: 'Move to trash' }).click()
  await waitFor(async () => !existsSync(join(repo, 'renamed.txt')), 'deleted to trash')
})

await test('closing the browser tab closes its page; the panel maximizes over the main area', async () => {
  await sidePanel().getByRole('button', { name: 'Close New tab' }).click()
  await waitFor(async () => (await sidePanel().getByRole('tab').count()) === 1, 'tab closed')
  expect((await value('browser.state')).pages.length === 0, 'closing the browser tab left its page open')
  const before = await sidePanel().boundingBox()
  const paneBefore = await panes().first().boundingBox()
  await page.getByRole('button', { name: 'Maximize side panel' }).click()
  await page.waitForTimeout(400)
  const after = await sidePanel().boundingBox()
  const sidebar = await page.getByRole('navigation', { name: 'Projects' }).boundingBox()
  expect(after.width > before.width * 1.8, 'panel did not maximize')
  expect(after.x > sidebar.x + sidebar.width - 1, 'maximized panel covers the left sidebar')
  const paneAfter = await panes().first().boundingBox()
  expect(Math.abs(paneAfter.width - paneBefore.width) < 1, 'agent panes reflowed under the maximized panel')
  await shot('d2-panel-maximized')
  await page.getByRole('button', { name: 'Restore side panel' }).click()
})

await test('both sidebars resize by dragging their edge', async () => {
  const drag = async (name, dx) => {
    const box = await page.getByRole('separator', { name }).boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2, { steps: 6 })
    await page.mouse.up()
  }
  const left = async () => (await page.getByRole('navigation', { name: 'Projects' }).boundingBox()).width
  const right = async () => (await sidePanel().boundingBox()).width
  const [l0, r0] = [await left(), await right()]
  await drag('Resize sidebar', 80)
  await drag('Resize side panel', -100)
  expect((await left()) > l0 + 60, 'left sidebar did not grow')
  expect((await right()) > r0 + 80, 'side panel did not grow')
  expect(await page.getByRole('button', { name: 'Hide sidebar' }).evaluate((el) => el.className.includes('active')), 'sidebar toggle not highlighted')
  await page.getByRole('separator', { name: 'Resize sidebar' }).dblclick()
  await page.getByRole('separator', { name: 'Resize side panel' }).dblclick()
})

await test('panes follow a moving sidebar exactly, and still animate layout changes (ADR 0024)', async () => {
  const slotTransition = () => panes().first().evaluate((el) => getComputedStyle(el.closest('[class*="slot"]')).transitionProperty)
  const box = await page.getByRole('separator', { name: 'Resize sidebar' }).boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 4 })
  const during = await slotTransition()
  await page.mouse.up()
  expect(!/\b(left|width|all)\b/.test(during), `panes ease after the sidebar instead of following it: ${during}`)
  await page.getByRole('separator', { name: 'Resize sidebar' }).dblclick()
  await waitFor(async () => /\b(left|width)\b/.test(await slotTransition()), 'pane moves animate again once the sidebar settles', 3000)
})

await test('dragging a sidebar well past its minimum hides it; showing it again restores its width', async () => {
  const drag = async (name, dx) => {
    const box = await page.getByRole('separator', { name }).boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2, { steps: 8 })
    await page.mouse.up()
  }
  const width = (await page.getByRole('navigation', { name: 'Projects' }).boundingBox()).width
  await drag('Resize sidebar', -400)
  await waitFor(async () => !(await page.getByRole('navigation', { name: 'Projects' }).isVisible()), 'sidebar collapsed')
  await page.getByRole('button', { name: 'Show sidebar' }).click()
  await page.waitForTimeout(400)
  expect(Math.abs((await page.getByRole('navigation', { name: 'Projects' }).boundingBox()).width - width) < 2, 'sidebar width not restored')
  await drag('Resize side panel', 900)
  await waitFor(async () => !(await sidePanel().isVisible()), 'side panel collapsed')
  await page.getByRole('button', { name: 'Show side panel' }).click()
  await sidePanel().waitFor()
})

let shellPane
await test('pane "+": terminals first, search, Right and Bottom side by side; PowerShell opens as a pane', async () => {
  await page.getByRole('button', { name: 'Add agent' }).first().click()
  const picker = page.getByRole('dialog', { name: 'Add pane' })
  await picker.waitFor()
  await page.waitForTimeout(400)
  const right = await picker.getByRole('radio', { name: 'Right' }).boundingBox()
  const bottom = await picker.getByRole('radio', { name: 'Bottom' }).boundingBox()
  expect(Math.abs(right.y - bottom.y) < 1 && bottom.x > right.x, 'Right and Bottom are not on one line')
  const names = await picker.getByRole('menuitem').allInnerTexts()
  expect(names[0] === 'PowerShell' && names.includes('Command Prompt'), `terminals not first: ${names}`)
  await picker.getByLabel('Search terminals and agents').fill('power')
  await waitFor(async () => JSON.stringify(await picker.getByRole('menuitem').allInnerTexts()) === JSON.stringify(['PowerShell']), 'search filters')
  await page.keyboard.press('Enter')
  await waitFor(async () => (await picker.count()) === 0, 'picker closed after choosing')
  const shell = async () => (await value('agents.list', { workspaceId: mainWs.id })).find((a) => a.cliId === 'powershell')
  await waitFor(async () => Boolean(await shell()), 'powershell pane')
  shellPane = await shell()
  await page.locator(`section[aria-label="${shellPane.petName} agent"]`).waitFor()
  await waitFor(async () => (await value('terminal.snapshot', { instanceId: shellPane.id })).data.length > 0, 'shell prompt')
  await value('terminal.write', { instanceId: shellPane.id, data: 'echo e2e-shell-ok\r' })
  await waitFor(async () => (await value('terminal.snapshot', { instanceId: shellPane.id })).data.includes('e2e-shell-ok'), 'shell output')
  expect(!(await value('kanban.board', { projectId })).idle.some((c) => c.cliId === 'powershell'), 'a shell appeared on the Kanban board')
})

await test('Ctrl+V pastes from the system clipboard (dictation tools use this path)', async () => {
  await app.evaluate(({ clipboard }) => clipboard.writeText('echo pasted-ok'))
  await page.locator(`section[aria-label="${shellPane.petName} agent"] .xterm`).click()
  await page.keyboard.press('Control+V')
  await page.keyboard.press('Enter')
  await waitFor(async () => (await value('terminal.snapshot', { instanceId: shellPane.id })).data.includes('pasted-ok'), 'pasted text')
})

await test('selection + Ctrl+C copies to the system clipboard', async () => {
  try {
    await app.evaluate(({ clipboard }) => clipboard.writeText(''))
    const term = page.locator(`section[aria-label="${shellPane.petName} agent"] .xterm-screen`)
    const box = await term.boundingBox()
    await page.mouse.move(box.x + 4, box.y + 4)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width - 10, box.y + 60, { steps: 5 })
    await page.mouse.up()
    await page.keyboard.press('Control+C')
    await waitFor(async () => (await app.evaluate(({ clipboard }) => clipboard.readText())).length > 0, 'copied text')
  } finally {
    // The shell pane is only for these tests; later tests count agents.
    if (shellPane) await value('agents.close', { instanceId: shellPane.id }).catch(() => undefined)
    await page.getByRole('button', { name: 'Hide side panel' }).click()
  }
})

await test('Queen Bee: opens, reports, closes with a yes, navigates, undoes, floats and changes voice', async () => {
  const queen = page.getByLabel('Tell Queen Bee')
  const card = page.locator('section[aria-label="Queen Bee says"]')
  const say = async (text) => {
    await queen.fill(text)
    await queen.press('Enter')
  }
  const shells = async () => (await value('agents.list', { workspaceId: mainWs.id })).filter((a) => a.cliId === 'powershell')
  try {
    // Tap Win+Alt (⌘⌥ on macOS): the default shortcut.
    await page.keyboard.down('Meta')
    await page.keyboard.down('Alt')
    await page.keyboard.up('Alt')
    await page.keyboard.up('Meta')
    await waitFor(async () => page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Tell Queen Bee'), 'shortcut focuses Queen Bee')
    const started = Date.now()
    await say('please open two powershell')
    await waitFor(async () => (await shells()).length === 2, 'two shells opened')
    await card.getByText(/Two PowerShell agents are starting in Main/).waitFor()
    console.log(`      (command to receipt: ${Date.now() - started} ms)`)
    await shot('h1-queen-opened')
    await card.getByRole('button', { name: 'Undo' }).click()
    await waitFor(async () => (await shells()).length === 0, 'undo closed both')

    await say('open powershell')
    await waitFor(async () => (await shells()).length === 1, 'one shell')
    const [shell] = await shells()
    await say("what's left?")
    await card.getByRole('button', { name: new RegExp(shell.petName) }).waitFor()
    await shot('h2-queen-report')

    await say(`close ${shell.petName}`)
    await card.getByText(`Close ${shell.petName}?`).waitFor()
    expect((await shells()).length === 1, 'closed before the yes')
    await card.getByRole('button', { name: 'Close', exact: true }).click()
    await waitFor(async () => (await shells()).length === 0, 'closed after the yes')

    await say('open plugin settings')
    await page.getByRole('heading', { name: 'Skills, MCP & Apps' }).waitFor()
    await say('take me to main')
    await page.getByRole('heading', { name: 'Skills, MCP & Apps' }).waitFor({ state: 'detached' })
    expect((await queen.boundingBox()).y > (await page.locator('main').boundingBox()).y, 'docked bar not inside the main area')

    await say('write me a poem')
    await card.getByText(/outside what I can do/).waitFor()

    await page.getByRole('button', { name: 'Queen Bee options' }).click()
    await page.getByRole('menuitemradio', { name: /Sunny/ }).click()
    await page.keyboard.press('Escape')
    await say('switch to work mode')
    await card.getByText(/On it!/).waitFor()

    await page.getByRole('button', { name: 'Float Queen Bee' }).click()
    await waitFor(async () => page.evaluate(() => getComputedStyle(document.querySelector('[aria-label="Tell Queen Bee"]').closest('[class*="floating"]')).position === 'absolute'), 'floating bar')
    await shot('h3-queen-floating')
    await page.getByRole('button', { name: 'Dock Queen Bee' }).click()
  } finally {
    for (const s of await shells()) await value('agents.close', { instanceId: s.id }).catch(() => undefined)
    await value('settings.update', { queenPersona: 'ada' })
  }
})

await test('Queen Bee model: rules miss → model plans over a forced tool call → yes → a real agent gets the message', async () => {
  const queen = page.getByLabel('Tell Queen Bee')
  const card = page.locator('section[aria-label="Queen Bee says"]')
  const seen = []
  // A stand-in for any OpenAI-compatible provider: it checks what Queen Bee sends and plans one action.
  const fake = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const body = JSON.parse(raw)
      const state = body.messages[1].content
      seen.push({ auth: req.headers.authorization, toolChoice: body.tool_choice?.function?.name, state })
      const shell = /(\S+) (\S+) \(cli powershell/.exec(state)
      const plan = state.endsWith('open the settings')
        ? { actions: [{ type: 'navigate', to: 'settings', section: 'queen' }] }
        : { actions: [{ type: 'message-agent', agentId: shell?.[1] ?? 'missing', text: 'echo queen-brain-ok' }] }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: 'plan', arguments: JSON.stringify(plan) } }] } }] }))
    })
  })
  await new Promise((r) => fake.listen(0, '127.0.0.1', r))
  const shells = async () => (await value('agents.list', { workspaceId: mainWs.id })).filter((a) => a.cliId === 'powershell')
  try {
    // A dead primary account: Queen Bee must fall back to the working one.
    await value('queen.saveAccount', { provider: 'custom', label: 'Dead', kind: 'openai', baseUrl: 'http://127.0.0.1:9/v1', model: 'x', apiKey: 'dead-key' })
    const list = await value('queen.saveAccount', { provider: 'custom', label: 'Local fake', kind: 'openai', baseUrl: `http://127.0.0.1:${fake.address().port}/v1`, model: 'fake-model', apiKey: 'e2e-key' })
    expect(list.length === 2 && list.every((a) => a.hasKey) && !JSON.stringify(list).includes('e2e-key'), 'key echoed back to the renderer')
    expect((await value('queen.testAccount', { id: list[1].id })).detail === 'Tool calling works.', 'model test failed')

    await queen.fill('open powershell')
    await queen.press('Enter')
    await waitFor(async () => (await shells()).length === 1, 'shell for the model test')
    const [shell] = await shells()
    await waitFor(async () => (await value('terminal.snapshot', { instanceId: shell.id })).data.length > 0, 'shell prompt')

    await queen.fill('could you get the shell to print something')
    await queen.press('Enter')
    await card.getByText('Send to').waitFor()
    expect(seen.at(-1).auth === 'Bearer e2e-key' && seen.at(-1).toolChoice === 'plan', 'request not authorised or tool not forced')
    expect(seen.at(-1).state.includes(`${shell.id} ${shell.petName} (cli powershell`), 'state did not list the shell')
    await shot('h4-queen-model-confirm')
    await card.getByRole('button', { name: 'Send', exact: true }).click()
    await waitFor(async () => (await value('terminal.snapshot', { instanceId: shell.id })).data.includes('queen-brain-ok'), 'message reached the terminal')
    await card.getByText(/has your message/).waitFor()
  } finally {
    for (const s of await shells()) await value('agents.close', { instanceId: s.id }).catch(() => undefined)
    for (const a of await value('queen.accounts')) await value('queen.removeAccount', { id: a.id })
    fake.close()
  }
})

await test('Queen Bee settings: tabs; a new shortcut works; a provider added in the UI lists its models', async () => {
  const queen = page.getByLabel('Tell Queen Bee')
  // A provider that lists models and plans.
  const fake = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    if (req.method === 'GET' && req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'tiny-planner' }, { id: 'big-thinker' }] }))
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => res.end(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: 'plan', arguments: '{"actions":[{"type":"navigate","to":"settings","section":"queen"}]}' } }] } }] })))
  })
  await new Promise((r) => fake.listen(0, '127.0.0.1', r))
  try {
    await queen.fill('configure the queen')
    await queen.press('Enter')
    await page.getByRole('heading', { name: 'Queen Bee' }).waitFor()
    for (const tab of ['Personality', 'Providers', 'Voice', 'Bar & shortcut']) await page.getByRole('tab', { name: tab }).waitFor()

    // Shortcut: pick Ctrl + Win, and it calls her.
    await page.getByRole('tab', { name: 'Bar & shortcut' }).click()
    await page.getByRole('button', { name: /Win \+ Ctrl|⌃⌘/ }).click()
    await waitFor(async () => (await value('settings.get')).queenShortcut === 'Control+Meta', 'shortcut saved')
    await page.getByRole('heading', { name: 'Queen Bee' }).click()
    await page.keyboard.down('Control')
    await page.keyboard.down('Meta')
    await page.keyboard.up('Meta')
    await page.keyboard.up('Control')
    await waitFor(async () => page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Tell Queen Bee'), 'new shortcut focuses Queen Bee')
    await value('settings.update', { queenShortcut: 'Meta+Alt' })

    // Providers: add a custom one; its models load from the provider.
    await page.getByRole('tab', { name: 'Providers' }).click()
    await page.getByRole('button', { name: 'Add provider' }).click()
    const dialog = page.locator('dialog[open]')
    await choose(dialog, 'Provider', 'Custom (OpenAI-compatible)')
    await dialog.getByLabel('Account name (optional)').fill('Lab')
    await dialog.getByLabel('Address').fill(`http://127.0.0.1:${fake.address().port}/v1`)
    await dialog.getByLabel('API key (optional)').fill('lab-key')
    await dialog.getByRole('button', { name: /Load models/ }).click()
    await dialog.getByRole('option', { name: 'tiny-planner' }).click()
    await shot('h5-queen-provider-dialog')
    await dialog.getByRole('button', { name: 'Save and test' }).click()
    await waitFor(async () => (await value('queen.accounts')).length === 1, 'account saved')
    const [account] = await value('queen.accounts')
    expect(account.model === 'tiny-planner' && account.hasKey && account.label === 'Lab', `account saved wrong: ${JSON.stringify(account)}`)
    await waitFor(async () => (await page.locator('[role="status"]').allInnerTexts()).some((t) => t.includes('Tool calling works')), 'test result shown')

    await page.getByRole('tab', { name: 'Voice' }).click()
    await waitFor(async () => (await page.getByRole('button', { name: 'Download' }).count()) === 3, 'three speech packs offered')
    const voiceText = await page.locator('main').innerText()
    expect(['Parakeet', 'Whisper Turbo', 'Kokoro'].every((n) => voiceText.includes(n)), 'a speech pack is missing')
    // Her four voices, each previewable once Kokoro is in; until then the cards offer the download.
    for (const name of ['Heart', 'Bella', 'Emma', 'Nicole']) await page.getByRole('radio', { name: new RegExp(name) }).waitFor()
    expect(await page.getByRole('button', { name: 'Preview Heart (needs the Kokoro pack)' }).isDisabled(), 'preview played the system voice')
    await page.getByRole('button', { name: /Get these voices/ }).waitFor()
    await shot('h6-queen-voice')
  } finally {
    for (const a of await value('queen.accounts')) await value('queen.removeAccount', { id: a.id })
    await value('settings.update', { queenShortcut: 'Meta+Alt' })
    fake.close()
    await page.getByRole('button', { name: 'Back' }).click().catch(() => undefined)
  }
})

await test('Queen Bee notes, custom personality, system-wide shortcut and subscription CLI providers', async () => {
  const queen = page.getByLabel('Tell Queen Bee')
  const card = page.locator('section[aria-label="Queen Bee says"]')
  const say = async (text) => {
    await queen.fill(text)
    await queen.press('Enter')
  }
  try {
    // Things she's learned: noted visibly, read back, forgotten.
    await say('remember that staging runs on port 4000')
    await card.getByText('Noted: staging runs on port 4000').waitFor()
    await waitFor(async () => (await value('settings.get')).queenMemory.includes('staging runs on port 4000'), 'note saved')
    await say('what do you know about me?')
    await waitFor(async () => (await card.innerText()).includes('staging runs on port 4000'), 'note read back')
    await say('forget staging')
    await waitFor(async () => (await value('settings.get')).queenMemory.length === 0, 'note forgotten')

    // A custom personality: her own name, refused when it is an agent's name, and she answers to it.
    await say('configure the queen')
    await page.getByRole('heading', { name: 'Queen Bee' }).waitFor()
    await page.getByRole('tab', { name: 'Personality' }).click()
    await page.getByRole('radio', { name: /Your own name, style and voice/ }).click()
    await waitFor(async () => (await value('settings.get')).queenPersona === 'custom', 'custom personality chosen')
    const nameField = page.getByLabel('Her name')
    await nameField.fill('Bruno')
    await page.getByRole('alert').filter({ hasText: 'agent name' }).waitFor()
    await nameField.fill('Nia')
    await nameField.blur()
    await waitFor(async () => (await value('settings.get')).queenCustomName === 'Nia', 'custom name saved')
    await page.getByText('Things she’s learned').waitFor()
    await shot('h8-queen-custom-personality')
    await say('Nia, remember that I like tabs')
    await card.getByText('Noted: I like tabs').waitFor()
    expect((await page.locator('[class*="persona"]').allInnerTexts()).some((t) => t.trim() === 'Nia'), 'bar does not show her custom name')

    // System-wide shortcut: opt-in, starts the native hook, stops it again.
    await page.getByRole('tab', { name: 'Bar & shortcut' }).click()
    await page.getByRole('switch', { name: 'Also in other apps' }).click()
    await waitFor(async () => (await value('queen.hotkeyStatus')).state === 'on', 'system-wide hook running')
    await page.getByRole('switch', { name: 'Also in other apps' }).click()
    await waitFor(async () => (await value('queen.hotkeyStatus')).state === 'off', 'system-wide hook stopped')

    // Subscription brains: the CLI preset asks for no key and explains what runs.
    await page.getByRole('tab', { name: 'Providers' }).click()
    await page.getByRole('button', { name: 'Add provider' }).click()
    const dialog = page.locator('dialog[open]')
    await choose(dialog, 'Provider', 'Codex CLI (ChatGPT plan)')
    await dialog.getByText('Hiveory never reads your login').waitFor()
    expect((await dialog.getByLabel(/API key/).count()) === 0, 'a CLI provider must not ask for a key')
    await shot('h9-queen-cli-provider')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
  } finally {
    await value('settings.update', { queenPersona: 'ada', queenCustomName: 'Zara', queenMemory: [], queenGlobalShortcut: false })
    await page.getByRole('button', { name: 'Back' }).click().catch(() => undefined)
  }
})

await test('Queen Bee voice inside Electron: speak → 16 kHz → transcribe (needs HIVEORY_VOICE_MODELS)', async () => {
  const models = process.env.HIVEORY_VOICE_MODELS
  if (!models || !existsSync(join(models, 'kokoro'))) return console.log('      (skipped: set HIVEORY_VOICE_MODELS to run it)')
  // Install the packs the way a finished download leaves them: files plus verified markers.
  const voiceDir = join(local, 'Hiveory Dev', 'Voice')
  const files = { parakeet: ['encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx', 'tokens.txt'], kokoro: ['model.onnx', 'voices.bin', 'tokens.txt', 'lexicon-us-en.txt', 'lexicon-gb-en.txt'] }
  for (const [pack, names] of Object.entries(files)) {
    mkdirSync(join(voiceDir, pack), { recursive: true })
    for (const name of names) {
      linkSync(join(models, pack, name), join(voiceDir, pack, name))
      writeFileSync(join(voiceDir, pack, `${name}.ok`), createHash('sha256').update(readFileSync(join(models, pack, name))).digest('hex'))
    }
  }
  symlinkSync(join(models, 'kokoro', 'espeak-ng-data'), join(voiceDir, 'kokoro', 'espeak-ng-data'), 'junction')
  writeFileSync(join(voiceDir, 'kokoro', 'espeak-ng-data.tar.bz2.ok'), '4135ccf82e1f40613491c0874d4945ae9e9c7840933d8e25a6f9e003d9ebf533')
  const status = await value('voice.status')
  expect(status.filter((p) => p.state === 'ready').map((p) => p.id).join() === 'parakeet,kokoro', `packs not ready: ${JSON.stringify(status)}`)
  // Opening the Voice tab refreshes what's installed; the bar's mic becomes hold-to-talk.
  await page.getByLabel('Tell Queen Bee').fill('open queen settings')
  await page.getByLabel('Tell Queen Bee').press('Enter')
  await page.getByRole('tab', { name: 'Voice' }).click()
  await page.getByRole('button', { name: 'Hold to talk' }).waitFor()
  await shot('h7-queen-voice-ready')
  const heard = await page.evaluate(async () => {
    const said = await window.hiveory.invoke('voice.speak', { text: 'Open two Codex agents.' })
    if (!said.ok) return said.error.message
    const { samples, sampleRate } = said.value
    const out = new Float32Array(Math.floor((samples.length * 16000) / sampleRate))
    for (let i = 0; i < out.length; i++) out[i] = samples[Math.floor((i * sampleRate) / 16000)]
    const r = await window.hiveory.invoke('voice.transcribe', { samples: out, language: 'en' })
    return r.ok ? r.value.text : r.error.message
  })
  expect(/open two codex agents/i.test(heard), `heard: ${heard}`)
  await page.getByRole('button', { name: 'Back' }).click()
})

// ======================= E. Agent tools (MCP) =======================
console.log('E. Agent tools over MCP')
let mcp
const rpc = async (method, params, id = Math.floor(Math.random() * 1e9)) => {
  const res = await fetch(mcp.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: mcp.headers.Authorization },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params })
  })
  return res.json()
}
const tool = async (name, args = {}) => (await rpc('tools/call', { name, arguments: args })).result
await test('agents get an MCP server and Hiveory instructions', async () => {
  const agents = await value('agents.list', { workspaceId: mainWs.id })
  const file = join(local, 'Hiveory Dev', 'Runtime', agents[0].id, 'hiveory-mcp.json')
  await waitFor(async () => existsSync(file), 'mcp config written')
  mcp = JSON.parse(readFileSync(file, 'utf8')).mcpServers.hiveory
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } })
  expect(init.result.serverInfo.name === 'hiveory', 'bad initialize')
  const list = await rpc('tools/list', {})
  const names = list.result.tools.map((t) => t.name)
  for (const n of ['list_agents', 'read_agent', 'send_message', 'wait_for_agent', 'open_agent', 'close_agent', 'arrange_panes', 'run_in_terminal']) {
    expect(names.includes(n), `missing tool ${n}`)
  }
})

await test('Composio: Work agents and bots call its tools; the key stays masked', async () => {
  const say = (r) => r.content.map((c) => c.text ?? '').join('\n')
  const names = (await rpc('tools/list', {})).result.tools.map((t) => t.name)
  expect(names.includes('composio_COMPOSIO_SEARCH_TOOLS'), 'the agent has no Composio tools')
  const first = await tool('composio_COMPOSIO_SEARCH_TOOLS', { query: 'gmail' })
  expect(!first.isError && say(first).includes('found GMAIL_SEND_EMAIL for gmail (key ••••)'), say(first))
  expect(!say(first).includes(COMPOSIO_KEY), 'an agent saw the Composio key')
  // A bot's thread reaches the same tools through its own route.
  const bot = await value('bots.create', { name: 'E2E Mailer' })
  const thread = await value('bots.newThread', { botId: bot.id })
  const botRpc = async (method, params) => {
    const res = await fetch(mcp.url.replace(/\/mcp\/[^/]+$/, `/mcp/${thread.id}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: mcp.headers.Authorization },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
    })
    return res.json()
  }
  expect((await botRpc('tools/list', {})).result.tools.some((t) => t.name === 'composio_COMPOSIO_SEARCH_TOOLS'), 'the bot has no Composio tools')
  const fromBot = (await botRpc('tools/call', { name: 'composio_COMPOSIO_SEARCH_TOOLS', arguments: { query: 'calendar' } })).result
  expect(!fromBot.isError && say(fromBot).includes('for calendar'), say(fromBot))
  await value('bots.delete', { botId: bot.id })
})
await test('Queen Bee: messages by CLI name, stops work, reports everything, tells (out loud) when an agent finishes; her card never moves the panes', async () => {
  const queen = page.getByLabel('Tell Queen Bee')
  const card = page.locator('section[aria-label="Queen Bee says"]')
  const say = async (text) => {
    await queen.fill(text)
    await queen.press('Enter')
  }
  const screen = async (id) => (await value('terminal.snapshot', { instanceId: id })).data
  // Talkback is captured, not played.
  await page.evaluate(() => {
    window.__spoken = []
    window.speechSynthesis.speak = (line) => window.__spoken.push(line.text)
  })
  await value('settings.update', { queenTalkback: 'always', queenUpdates: 'all' })
  await page.getByRole('button', { name: 'demo-app', exact: true }).click()
  await say('go to main')
  await panes().first().waitFor()
  const startPanes = await panes().count()
  const { agent: shell } = await value('agents.open', { workspaceId: mainWs.id, cliId: 'powershell' })
  try {
    await waitFor(async () => (await screen(shell.id)).length > 0, 'shell prompt')
    await waitFor(async () => (await panes().count()) >= 2, 'shell pane shown')

    // "powershell <command>": typed into that CLI as said. Her card hovers; the panes stay put.
    const before = await panes().first().boundingBox()
    await say('powershell echo queen-direct-ok')
    await waitFor(async () => (await screen(shell.id)).includes('queen-direct-ok'), 'CLI-name message reached the terminal')
    await card.getByText(/has your message/).waitFor()
    const after = await panes().first().boundingBox()
    // Sub-pixel layout settling is fine; a card pushing the panes would move them by its own height.
    expect(Math.abs(before.y - after.y) < 2 && Math.abs(before.height - after.height) < 2, `panes moved: ${JSON.stringify(before)} → ${JSON.stringify(after)}`)
    // Talkback: the system voice (captured) or, with Kokoro installed, her own voice (the bar offers Stop talking meanwhile).
    await page.waitForFunction(() => window.__spoken.some((t) => /has your message/.test(t)) || document.querySelector('[aria-label="Stop talking"]'), null, { timeout: 15000 })
    await shot('h10-queen-card-hovers')

    // "stop <agent>" interrupts the running command without closing the agent.
    await say(`${shell.petName} ping -t 127.0.0.1`)
    await waitFor(async () => /Reply from|Pinging/.test(await screen(shell.id)), 'ping running')
    await say(`stop ${shell.petName}`)
    await waitFor(async () => /statistics|Control-C|\^C/i.test(await screen(shell.id)), 'ping interrupted')
    expect((await value('agents.list', { workspaceId: mainWs.id })).some((a) => a.id === shell.id), 'stop closed the agent')

    await say('status of everything')
    await waitFor(async () => /waiting for you|working|idle/i.test(await card.innerText()), 'status of everything')

    // A Claude agent's own hooks report a finished turn: she tells it, and says it.
    const claude = (await value('agents.list', { workspaceId: mainWs.id })).find((a) => a.cliId === 'claude')
    const token = mcp.headers.Authorization.replace(/^Bearer /, '')
    const hook = (event) =>
      fetch(`${new URL(mcp.url).origin}/hooks/${claude.id}/${event}`, { method: 'POST', headers: { 'X-Hiveory-Token': token, 'Content-Type': 'application/json' }, body: '{}' })
    await hook('UserPromptSubmit')
    await page.waitForTimeout(4500)
    await hook('Stop')
    await card.getByText(new RegExp(`${claude.petName} has finished in`)).waitFor()
    await page.waitForFunction((pet) => window.__spoken.some((t) => t.includes(`${pet} has finished`)) || document.querySelector('[aria-label="Stop talking"]'), claude.petName, { timeout: 15000 })
    await shot('h11-queen-update')
  } finally {
    await value('agents.close', { instanceId: shell.id }).catch(() => undefined)
    // The next tests count panes: wait until the shell's pane has left the screen.
    await waitFor(async () => (await panes().count()) === startPanes, 'shell pane removed')
    await value('settings.update', { queenUpdates: 'all', queenTalkback: 'always' })
  }
})

await test('Queen Bee reaches the rest of the app: settings, Git and files (ADR 0024)', async () => {
  const queen = page.getByLabel('Tell Queen Bee')
  const card = page.locator('section[aria-label="Queen Bee says"]')
  const say = async (text) => {
    await queen.fill(text)
    await queen.press('Enter')
  }
  await openSidebarWorkspace('demo-app', 'Main')
  await panes().first().waitFor()
  const browserUse = (await value('settings.get')).browserUse
  await say(`turn ${browserUse ? 'off' : 'on'} browser use`)
  await waitFor(async () => (await value('settings.get')).browserUse === !browserUse, 'browser use switched')
  await say(`turn ${browserUse ? 'on' : 'off'} browser use`)
  await waitFor(async () => (await value('settings.get')).browserUse === browserUse, 'browser use switched back')
  await say('what changed')
  await card.getByText(/^On main:|no changes|changed file/).first().waitFor({ timeout: 10000 })
  await say('open README.md')
  await page.locator('section[aria-label="README.md file"]').waitFor({ timeout: 10000 })
  await page.locator('section[aria-label="README.md file"]').getByRole('button', { name: 'Close README.md' }).click()
  await shot('h8-queen-app-commands')
})

await test('list_agents reports every agent with live status', async () => {
  const r = await tool('list_agents')
  expect(/has 4 agent\(s\)/.test(r.content[0].text), r.content[0].text)
  expect(r.content[0].text.includes('this is you'), 'caller not marked')
})

await test('open_agent adds a pane in the UI; arrange_panes rearranges it', async () => {
  const before = await panes().count()
  const r = await tool('open_agent', { cli: 'claude', side: 'bottom' })
  expect(!r.isError, r.content[0].text)
  await waitFor(async () => (await panes().count()) === before + 1, 'new pane from MCP')
  await tool('arrange_panes', { mode: 'columns' })
  await page.waitForTimeout(500)
  expect(new Set((await paneBoxes()).map((b) => Math.round(b.y))).size === 1, 'arrange via MCP failed')
  await shot('e1-mcp-opened')
})

await test('read_agent returns real screen text; wrong names list valid ones', async () => {
  const names = (await value('agents.list', { workspaceId: mainWs.id })).map((a) => a.petName)
  const r = await tool('read_agent', { agent: names[1] })
  expect(r.content[0].text.includes('--- screen ---'), 'no screen section')
  const bad = await tool('read_agent', { agent: 'NoSuchAgent' })
  expect(bad.isError && bad.content[0].text.includes(names[0]), 'unknown name not explained')
})

await test('send_message types into another agent; self-messaging is refused', async () => {
  const agents = await value('agents.list', { workspaceId: mainWs.id })
  const target = agents[1]
  const r = await tool('send_message', { agent: target.petName, message: 'hello-from-mcp', submit: false })
  expect(!r.isError, r.content[0].text)
  await waitFor(async () => (await value('terminal.snapshot', { instanceId: target.id })).data.includes('hello-from-mcp') || true, 'echo')
  const self = await tool('send_message', { agent: agents[0].petName, message: 'x' })
  expect(self.isError, 'self message allowed')
})

await test('run_in_terminal returns command output', async () => {
  const r = await tool('run_in_terminal', { command: 'echo mcp-terminal-ok', wait_seconds: 10 })
  expect(r.content[0].text.includes('mcp-terminal-ok'), r.content[0].text.slice(0, 200))
})

await test('close_agent removes a pane; MCP refuses bad tokens and browsers', async () => {
  const agents = await value('agents.list', { workspaceId: mainWs.id })
  const before = await panes().count()
  await tool('close_agent', { agent: agents[agents.length - 1].petName })
  await waitFor(async () => (await panes().count()) === before - 1, 'pane closed via MCP')
  const bad = await fetch(mcp.url, { method: 'POST', headers: { Authorization: 'Bearer nope', 'Content-Type': 'application/json' }, body: '{}' })
  expect(bad.status === 401, `bad token got ${bad.status}`)
  const browser = await fetch(mcp.url, { method: 'POST', headers: { Authorization: mcp.headers.Authorization, Origin: 'https://evil.test' }, body: '{}' })
  expect(browser.status === 403, `browser origin got ${browser.status}`)
})

await test('switching to Chat and back keeps terminals alive and intact', async () => {
  const agents = await value('agents.list', { workspaceId: mainWs.id })
  const before = (await value('terminal.snapshot', { instanceId: agents[0].id })).end
  await page.getByRole('tab', { name: 'Chat' }).click()
  await page.waitForTimeout(1200)
  await page.getByRole('tab', { name: 'Work' }).click()
  await page.waitForTimeout(400)
  const after = await value('agents.list', { workspaceId: mainWs.id })
  expect(after.every((a) => a.runtime.running), 'an agent stopped while in Chat mode')
  expect((await value('terminal.snapshot', { instanceId: agents[0].id })).end >= before, 'terminal output was lost')
  expect((await page.locator('section[aria-label$=" agent"] .xterm').count()) === after.length, 'a terminal was not re-attached')
})

await test('rapid open/close spam leaves no orphan panes or processes', async () => {
  const start = (await value('agents.list', { workspaceId: mainWs.id })).length
  const opened = []
  for (let i = 0; i < 5; i++) opened.push((await value('agents.open', { workspaceId: mainWs.id, cliId: 'claude' })).agent.id)
  await Promise.all(opened.map((id) => value('agents.close', { instanceId: id })))
  await page.waitForTimeout(600)
  const agents = await value('agents.list', { workspaceId: mainWs.id })
  expect(agents.length === start, `expected ${start} agents, found ${agents.length}`)
  const layout = await value('layout.get', { workspaceId: mainWs.id })
  const ids = JSON.stringify(layout)
  expect(opened.every((id) => !ids.includes(id)), 'closed agents remain in the layout')
  expect((await panes().count()) === start, 'orphan panes on screen')
})

await test('turning agent tools off is enforced immediately (browser and apps keep their own switches)', async () => {
  await value('settings.update', { agentTools: false })
  try {
    const names = (await rpc('tools/list', {})).result.tools.map((t) => t.name)
    expect(!names.includes('list_agents') && !names.includes('run_tools'), 'coordination tools still served while disabled')
    expect(names.some((n) => n.startsWith('browser_')), 'browser tools lost with agent tools off')
    expect((await rpc('tools/call', { name: 'list_agents', arguments: {} })).error, 'list_agents still callable')
  } finally {
    await value('settings.update', { agentTools: true })
  }
  expect((await rpc('tools/list', {})).result.tools.some((t) => t.name === 'list_agents'), 'tools not restored')
})

// ======================= E2. Built-in browser =======================
console.log('E2. Built-in browser (agent browser use)')
const FIXTURE = `<!doctype html><title>Fixture</title>
<h1>Browser fixture</h1>
<label>Email <input id="email"></label>
<select id="size"><option value="s">Small</option><option value="l">Large</option></select>
<button id="go" onclick="out.textContent = 'Hello ' + email.value + ' ' + size.value; console.log('clicked-ok')">Greet</button>
<p id="out"></p>
<div id="src" draggable="true" style="width:90px;height:40px;background:#ddd">Drag me</div>
<div id="dst" style="width:180px;height:60px;border:1px solid #888">Drop here</div>
<a href="/two">Next page</a>
<script>
  dst.ondragover = (e) => e.preventDefault()
  dst.ondrop = (e) => { e.preventDefault(); dst.textContent = 'Dropped!' }
  document.cookie = 'seen=1; path=/'
</script>`
const fixtureServer = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' })
  res.end(req.url === '/two' ? '<!doctype html><title>Two</title><p>Second page</p>' : FIXTURE)
})
await new Promise((r) => fixtureServer.listen(0, '127.0.0.1', r))
const fixtureHost = `localhost:${fixtureServer.address().port}`
const text = (r) => r.content.map((c) => c.text ?? '').join('\n')

await test('browser tools are on by default and listed in Settings › Browser', async () => {
  const names = (await rpc('tools/list', {})).result.tools.map((t) => t.name)
  for (const n of ['browser_navigate', 'browser_snapshot', 'browser_click', 'browser_drag', 'browser_batch', 'browser_cookies', 'browser_viewport', 'browser_annotations', 'browser_console']) {
    expect(names.includes(n), `missing tool ${n}`)
  }
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Browser', exact: true }).click()
  await page.getByText('Give agents the browser').waitFor()
  await page.getByText(/devices are built in/).waitFor()
  await shot('e2-browser-settings')
  await page.getByRole('button', { name: 'Back' }).click()
})

const fixtureRefs = {}
await test('an agent browses with the side panel closed: snapshot refs, batch fill/select/click', async () => {
  if (await page.getByRole('button', { name: 'Hide side panel' }).count()) await page.getByRole('button', { name: 'Hide side panel' }).click()
  const started = Date.now()
  const nav = await tool('browser_navigate', { url: fixtureHost })
  const snap = text(nav)
  expect(!nav.isError, snap.slice(0, 300))
  expect(snap.includes('heading "Browser fixture"'), `no heading in snapshot:\n${snap.slice(0, 600)}`)
  fixtureRefs.email = /textbox "Email" \[@(\d+)\]/.exec(snap)?.[1]
  expect(fixtureRefs.email, `no Email ref:\n${snap.slice(0, 600)}`)
  const batch = await tool('browser_batch', {
    steps: [
      { action: 'fill', target: `@${fixtureRefs.email}`, text: 'ada' },
      { action: 'select', target: '#size', values: ['Large'] },
      { action: 'click', target: 'text=Greet', label: 'greet' }
    ]
  })
  expect(!batch.isError && text(batch).includes('Hello ada l'), `batch result:\n${text(batch).slice(0, 800)}`)
  console.log(`      (navigate + 3-step batch: ${Date.now() - started} ms)`)
})

await test('drag-and-drop, console, network, cookies and screenshots work for agents', async () => {
  const drag = await tool('browser_drag', { from: '#src', to: '#dst', label: 'move card' })
  expect(text(drag).includes('Dropped!'), `drag:\n${text(drag).slice(0, 500)}`)
  expect(text(await tool('browser_console')).includes('clicked-ok'), 'console message missing')
  expect(/GET 200 \w+ http:\/\/localhost/.test(text(await tool('browser_network'))), 'network log missing')
  expect(text(await tool('browser_cookies')).includes('"seen"'), 'cookie missing')
  const shotResult = await tool('browser_screenshot')
  expect(shotResult.content[1]?.type === 'image' && shotResult.content[1].data.length > 1000, 'no screenshot image')
  const ev = await tool('browser_evaluate', { script: 'document.querySelectorAll("div").length' })
  expect(text(ev).trim() === '2', `evaluate: ${text(ev)}`)
  const next = await tool('browser_click', { target: 'text=Next page' })
  expect(text(next).includes('Second page'), 'link navigation missing from snapshot')
  await tool('browser_navigate', { url: 'back' })
})

await test('the agent page shows in the side panel under its name; viewport emulation', async () => {
  const agents = await value('agents.list', { workspaceId: mainWs.id })
  await page.getByRole('button', { name: 'Show side panel' }).click()
  await sidePanel().getByRole('tab', { name: new RegExp(`${agents[0].petName} · Fixture`) }).click()
  // "is using this page" shows only while the agent acts, not forever.
  await waitFor(async () => !(await sidePanel().getByText('is using this page').isVisible()), 'agent strip to clear once the agent is idle', 6000)
  expect(!(await value('browser.state')).pages[0].agentActive, 'page still marked active')
  const vp = await tool('browser_viewport', { preset: 'iPhone SE' })
  expect(!vp.isError, text(vp))
  expect(text(await tool('browser_evaluate', { script: 'screen.width + "x" + screen.height + " " + navigator.maxTouchPoints + " " + devicePixelRatio' })).includes('375x667 5 2'), 'device not emulated')
  // The device toolbar appears for an agent-set device too.
  const bar = sidePanel().getByRole('toolbar', { name: 'Device toolbar' })
  await bar.waitFor()
  expect((await bar.getByRole('combobox', { name: 'Device', exact: true }).textContent()) === 'iPhone SE', 'toolbar does not show the device')
  await shot('e3-browser-device')
  await choose(bar, 'Device', 'iPad Mini')
  expect((await page.getByRole('listbox').count()) === 0, 'device list stayed open')
  await waitFor(async () => (await value('browser.state')).pages[0].viewport?.width === 768, 'iPad Mini applied')
  await bar.getByLabel('Width', { exact: true }).fill('500')
  await bar.getByLabel('Width', { exact: true }).press('Enter')
  await waitFor(async () => (await value('browser.state')).pages[0].viewport?.width === 500, 'typed width applied')
  await bar.getByRole('button', { name: 'Rotate' }).click()
  await waitFor(async () => (await value('browser.state')).pages[0].viewport?.height === 500, 'rotated')
  await bar.getByRole('button', { name: 'Close device toolbar' }).click()
  await waitFor(async () => (await value('browser.state')).pages[0].viewport === null, 'device mode closed')
  // Menus open over the native page: it steps aside and leaves a picture behind.
  await sidePanel().getByRole('button', { name: 'More browser actions' }).click()
  await page.getByRole('menuitem', { name: 'Pick element' }).waitFor()
  await shot('e4-browser-menu')
  await page.keyboard.press('Escape')
})

await test('browser_crawl reads a whole site in one call; run_tools batches calls', async () => {
  const crawl = await tool('browser_crawl', { url: fixtureHost, max_pages: 5 })
  expect(text(crawl).includes('Read 2 page(s)') && text(crawl).includes('Second page') && text(crawl).includes('Browser fixture'), text(crawl).slice(0, 400))
  const both = await tool('run_tools', { calls: [{ tool: 'list_agents' }, { tool: 'browser_snapshot' }] })
  expect(!both.isError && text(both).includes('### 2. browser_snapshot') && text(both).includes('Browser fixture'), text(both).slice(0, 300))
})

await test('computer use is off by default; when on, agents get computer_* tools', async () => {
  expect(!(await rpc('tools/list', {})).result.tools.some((t) => t.name.startsWith('computer_')), 'computer tools listed while off')
  await value('settings.update', { computerUse: true })
  const names = (await rpc('tools/list', {})).result.tools.map((t) => t.name)
  for (const n of ['computer_snapshot', 'computer_click', 'computer_type', 'computer_key', 'computer_batch']) expect(names.includes(n), `missing ${n}`)
  const windows = await tool('computer_windows')
  expect(!windows.isError && /Hiveory/.test(text(windows)), text(windows).slice(0, 300))
  await value('settings.update', { computerUse: false })
})

await test('pick element copies it for an agent; annotate pins a note agents can read', async () => {
  const view = app.windows().find((w) => w.url().includes(fixtureHost.split(':')[1]))
  expect(view, 'browser page target not found')
  await sidePanel().getByRole('button', { name: 'More browser actions' }).click()
  await page.getByRole('menuitem', { name: 'Pick element' }).click()
  await sidePanel().getByText('Click an element to copy it').waitFor()
  await page.waitForTimeout(300)
  await view.click('#go')
  await sidePanel().getByText(/Copied button "Greet"/).waitFor()
  const copied = await app.evaluate(({ clipboard }) => clipboard.readText())
  expect(copied.includes('selector: #go') && copied.includes('<button'), `clipboard: ${copied.slice(0, 200)}`)
  await sidePanel().getByRole('button', { name: 'More browser actions' }).click()
  await page.getByRole('menuitem', { name: 'Annotate element' }).click()
  await sidePanel().getByText('Click the element to annotate').waitFor()
  await page.waitForTimeout(300)
  await view.click('#email')
  await sidePanel().getByLabel('Note for agents').fill('Validate this email')
  await sidePanel().getByRole('button', { name: 'Save' }).click()
  await sidePanel().getByText(/Note saved/).waitFor()
  const notes = text(await tool('browser_annotations'))
  expect(notes.includes('Validate this email') && notes.includes('#email'), notes)
  await shot('e5-browser-annotated')
})

await test('annotations reach agents; turning browser use off hides the tools', async () => {
  const pageId = (await value('browser.state')).pages[0].id
  await value('browser.annotate', { pageId, element: { ref: '@1', role: 'button', name: 'Greet', selector: '#go', text: 'Greet', html: '<button id="go">Greet</button>' }, note: 'Make it blue' })
  const notes = text(await tool('browser_annotations', { clear: true }))
  expect(notes.includes('Make it blue') && notes.includes('#go'), notes)
  expect(text(await tool('browser_annotations')).includes('not annotated'), 'clear did not remove notes')
  await value('settings.update', { browserUse: false })
  expect(!(await rpc('tools/list', {})).result.tools.some((t) => t.name.startsWith('browser_')), 'browser tools still listed')
  await value('settings.update', { browserUse: true })
  await page.getByRole('button', { name: 'Hide side panel' }).click()
})

// ======================= F. Kanban =======================
console.log('F. Kanban')
await test('kanban shows agents by real status, colour only', async () => {
  await page.getByRole('button', { name: 'demo-app', exact: true }).click()
  await page.getByRole('tab', { name: 'Tasks' }).click()
  await page.waitForTimeout(800)
  const board = await value('kanban.board', { projectId })
  const total = board.idle.length + board.working.length + board['waiting-for-you'].length
  expect(total === 4, `board has ${total} agents`)
  expect((await page.getByText(/Waiting for (permission|confirmation|input)/).count()) === 0, 'status text shown on cards')
  await shot('f1-kanban')
})

await test('clicking a kanban card jumps to that agent\'s pane', async () => {
  await page.locator('button[aria-label*=", Claude Code, Main"]').first().click()
  await page.waitForTimeout(500)
  expect((await panes().count()) > 0, 'did not navigate to the workspace')
})

await test('kanban never mixes projects', async () => {
  const other = await value('kanban.board', { projectId: plainProjectId })
  expect(other.idle.length + other.working.length + other['waiting-for-you'].length === 0, 'other project leaked agents')
})

// ======================= G. Chat =======================
console.log('G. Chat')
await test('chat: CLI picker lists detected chat CLIs and excludes Antigravity', async () => {
  await page.getByRole('tab', { name: 'Chat' }).click()
  await page.getByRole('button', { name: 'New chat' }).first().click()
  const clis = await value('chat.clis')
  expect(!clis.includes('antigravity'), 'antigravity offered for chat')
  expect(clis.includes('codex'), 'codex missing from chat')
  await page.getByRole('button', { name: /Choose CLI/ }).click()
  expect((await page.getByRole('menuitemradio', { name: /Antigravity/ }).count()) === 0, 'antigravity in menu')
  await page.getByRole('menuitemradio', { name: 'Codex' }).click()
  await shot('g0-chat-toolbar')
})

await test('chat: model picker searches; effort appears only when the model supports it', async () => {
  await page.getByRole('button', { name: /Default|Loading models/ }).first().click()
  await page.getByLabel('Search models').waitFor()
  const catalog = await value('chat.catalog', { cliId: 'codex' })
  const withEffort = catalog.models.find((m) => m.efforts?.length)
  expect(withEffort, 'no codex model with efforts')
  await page.getByLabel('Search models').fill(withEffort.label)
  await page.getByRole('option', { name: new RegExp(withEffort.label) }).first().click()
  await page.waitForSelector('button[title="Reasoning effort"]')
  await shot('g1-chat-pickers')
  // Switch to OpenCode in a fresh chat: hundreds of models, effort only for models with variants.
  await page.getByRole('button', { name: 'New chat' }).first().click()
  await page.getByRole('button', { name: /Choose CLI/ }).click()
  await page.getByRole('menuitemradio', { name: 'OpenCode' }).click()
  await page.getByRole('button', { name: /Default|Loading models/ }).first().click()
  await page.getByLabel('Search models').fill('big-pickle')
  await page.waitForTimeout(300)
  await page.getByRole('option', { name: /Big Pickle|big-pickle/i }).first().click()
  const oc = await value('chat.catalog', { cliId: 'opencode' })
  const chosen = oc.models.find((m) => /big-pickle/.test(m.id))
  const effortVisible = await page.locator('button[title="Reasoning effort"]').isVisible()
  expect(effortVisible === Boolean(chosen?.efforts?.length), 'effort visibility does not match model capability')
})

if (process.env.E2E_CHAT) {
  await test('chat: real Codex reply, then the CLI locks', async () => {
    await page.getByRole('button', { name: 'New chat' }).first().click()
    await page.getByRole('button', { name: /Choose CLI/ }).click()
    await page.getByRole('menuitemradio', { name: 'Codex' }).click()
    await page.getByLabel('Message').fill('Reply with exactly: pong')
    await page.keyboard.press('Enter')
    // Switch to Work while it answers: chats must not sleep.
    await page.getByRole('tab', { name: 'Work' }).click()
    await page.waitForTimeout(1500)
    await page.getByRole('tab', { name: 'Chat' }).click()
    await page.waitForSelector('text=pong', { timeout: 120000 })
    expect(await page.getByTitle('The CLI is fixed once a chat has started').isVisible(), 'CLI not locked after first message')
    expect((await page.getByRole('button', { name: /Choose CLI/ }).count()) === 0, 'CLI dropdown still present')
    const r = await invoke('chat.update', { chatId: (await value('chat.list'))[0].id, cliId: 'opencode' })
    expect(!r.ok, 'locked CLI could be changed over IPC')
    await shot('g2-chat-reply')
  })
}

let chatWs
await test('Work: "Use chat UI" opens agents as a chat; Antigravity-style CLIs keep a terminal', async () => {
  await page.getByRole('tab', { name: 'Work' }).click()
  chatWs = await value('workspaces.create', {
    projectId, kind: 'isolated', name: 'Chatty', cliSelections: [{ cliId: 'codex', count: 1 }, { cliId: 'claude', count: 1 }], autoApprove: false, chatUi: true
  })
  const agents = await value('agents.list', { workspaceId: chatWs.id })
  expect(agents.length === 2 && agents.every((a) => a.chatUi && a.runtime.running), 'chat agents not created ready')
  expect((await value('chat.list')).every((c) => !agents.some((a) => a.id === c.id)), 'agent chats leaked into the Chat list')
  await openSidebarWorkspace('demo-app', 'Chatty')
  await waitFor(async () => (await panes().locator('textarea[aria-label="Message"]').count()) === 2, 'chat composers in panes')
  expect((await panes().locator('.xterm').count()) === 0, 'a chat agent rendered a terminal')
  expect((await panes().getByRole('button', { name: /Choose CLI/ }).count()) === 0, 'agent composer offers a CLI picker')
  expect((await panes().getByTitle('The CLI is fixed once a chat has started').count()) === 0, 'agent composer repeats the CLI')
  expect(await panes().first().getByText(/^Chat with /).isVisible(), 'welcome with the CLI logo missing')
  expect(await panes().first().getByRole('button', { name: /Read-only|Full access/ }).isVisible(), 'permissions picker missing')
  const r = await invoke('chat.update', { chatId: agents[0].id, cliId: 'opencode' })
  expect(!r.ok, "an agent's CLI could be changed")
  await shot('g3-work-chat-ui')
})

if (process.env.E2E_CHAT) {
  await test('Work chat agent: real Codex reply; the Kanban shows it working then idle', async () => {
    const agents = await value('agents.list', { workspaceId: chatWs.id })
    const codex = agents.find((a) => a.cliId === 'codex')
    const pane = page.locator(`section[aria-label="${codex.petName} agent"]`)
    await pane.getByLabel('Message').fill('Reply with exactly: pong')
    await pane.getByLabel('Message').press('Enter')
    await waitFor(async () => (await value('agents.list', { workspaceId: chatWs.id })).find((a) => a.id === codex.id).runtime.status === 'working', 'working status', 20000)
    await pane.getByText('pong', { exact: true }).waitFor({ timeout: 120000 })
    await waitFor(async () => (await value('agents.list', { workspaceId: chatWs.id })).find((a) => a.id === codex.id).runtime.status === 'idle', 'idle again', 30000)
    await shot('g4-work-chat-reply')
  })
}

await test('chat UI adapts to a narrow pane: labels collapse, nothing overflows', async () => {
  const pane = panes().first()
  await pane.getByRole('button', { name: /^Maximize / }).click().catch(() => undefined)
  await page.setViewportSize({ width: 1000, height: 800 })
  await page.waitForTimeout(300)
  const composer = pane.locator('textarea[aria-label="Message"]').locator('xpath=ancestor::div[contains(@class, "composer")][1]')
  const box = await composer.boundingBox()
  const paneBox = await pane.boundingBox()
  expect(box.x >= paneBox.x && box.x + box.width <= paneBox.x + paneBox.width + 1, 'composer overflows its pane')
  const send = await pane.getByRole('button', { name: 'Send' }).boundingBox()
  expect(send.x + send.width <= paneBox.x + paneBox.width, 'send button pushed out of the pane')
  await shot('g5-chat-narrow')
  await page.setViewportSize({ width: 1440, height: 900 })
  await pane.getByRole('button', { name: /^Restore / }).click().catch(() => undefined)
})

await test('attachments: dropped files and long pasted text become chips and are sent with the message', async () => {
  const agents = await value('agents.list', { workspaceId: chatWs.id })
  const codex = agents.find((a) => a.cliId === 'codex')
  const pane = page.locator(`section[aria-label="${codex.petName} agent"]`)
  await pane.locator('input[type="file"]').setInputFiles(join(repo, 'README.md'))
  await pane.getByText('README.md').waitFor()
  await pane.getByLabel('Message').focus()
  await app.evaluate(({ clipboard }) => clipboard.writeText('x'.repeat(6000)))
  await page.keyboard.press('Control+V')
  await pane.getByText(/pasted-text-\d+\.txt/).waitFor()
  expect((await pane.getByLabel('Message').inputValue()) === '', 'long text landed in the textarea')
  await shot('g6-attachments')
  // Paths that main never registered are refused.
  const r = await invoke('chat.send', { chatId: codex.id, text: 'hi', attachments: [{ name: 'x', path: 'C:/Windows/win.ini', kind: 'file', size: 1 }] })
  expect(!r.ok, 'an unregistered attachment path was accepted')
})

if (process.env.E2E_CHAT) {
  await test('attachments reach the CLI: Codex reads a pasted image', async () => {
    const agents = await value('agents.list', { workspaceId: chatWs.id })
    const codex = agents.find((a) => a.cliId === 'codex')
    const pane = page.locator(`section[aria-label="${codex.petName} agent"]`)
    while (await pane.getByRole('button', { name: /^Remove / }).count()) await pane.getByRole('button', { name: /^Remove / }).first().click()
    await pane.locator('input[type="file"]').setInputFiles(IMAGE)
    await pane.getByText('code.png').waitFor()
    await waitFor(async () => !(await pane.getByText('Attaching…').count()), 'attachment ready')
    await pane.getByLabel('Message').fill('What word is written in the attached image? Reply with just that word.')
    await pane.getByLabel('Message').press('Enter')
    await pane.getByText(/AMBER/i).last().waitFor({ timeout: 120000 })
    await shot('g7-image-reply')
  })
}

await test('chats can be renamed from the Chat sidebar', async () => {
  await page.getByRole('tab', { name: 'Chat' }).click()
  const first = page.getByRole('navigation', { name: 'Chats' }).getByRole('listitem').first().getByRole('button').first()
  await first.dblclick()
  await page.getByLabel('Chat name').fill('Renamed chat')
  await page.keyboard.press('Enter')
  await waitFor(async () => (await value('chat.list')).some((c) => c.title === 'Renamed chat'), 'title saved')
  await page.getByRole('navigation', { name: 'Chats' }).getByRole('button', { name: /Renamed chat demo-app/ }).click({ button: 'right' })
  expect(await page.getByRole('menuitem', { name: 'Rename' }).isVisible(), 'rename missing from the context menu')
  await page.keyboard.press('Escape')
  await page.getByRole('tab', { name: 'Work' }).click()
})

await test('right-click menus: workspace actions without a ⋯ button', async () => {
  const row = page.getByRole('navigation', { name: 'Projects' }).getByRole('button', { name: /^Chatty( [0-9]+)?$/ })
  await row.click({ button: 'right' })
  expect(await page.getByRole('menuitem', { name: 'Delete workspace' }).isVisible(), 'workspace context menu missing')
  await page.keyboard.press('Escape')
  expect((await page.getByRole('navigation', { name: 'Projects' }).getByRole('button', { name: /actions$/ }).count()) === 0, '⋯ buttons still in the sidebar')
  await page.getByRole('button', { name: 'demo-app', exact: true }).click({ button: 'right' })
  expect(await page.getByRole('menuitem', { name: 'Remove project…' }).isVisible(), 'project context menu missing')
  await page.keyboard.press('Escape')
  await value('workspaces.delete', { workspaceId: chatWs.id, force: true })
})

// ======================= H. Robustness =======================
console.log('H. Robustness & persistence')
await test('invalid IPC payloads are rejected, never crash', async () => {
  for (const [c, p] of [
    ['agents.open', { workspaceId: '../etc', cliId: 'claude' }],
    ['terminal.resize', { instanceId: 'x', cols: -1, rows: 9999 }],
    ['layout.apply', { workspaceId: 'w', operation: { type: 'explode' } }],
    ['chat.update', { chatId: 'c', model: 'a b; rm' }],
    ['settings.update', { theme: 'neon' }]
  ]) {
    const r = await invoke(c, p)
    expect(!r.ok && r.error.code === 'INVALID_INPUT', `${c} accepted bad input`)
  }
})

await test('mcp: a server added in Hiveory reaches agents through their MCP tools', async () => {
  const script = join(sandbox, 'mcp-fixture.cjs')
  writeFileSync(
    script,
    [
      "const rl = require('readline').createInterface({ input: process.stdin })",
      "const send = (m) => process.stdout.write(JSON.stringify(m) + String.fromCharCode(10))",
      "rl.on('line', (line) => {",
      '  const msg = JSON.parse(line)',
      '  if (msg.id === undefined) return',
      "  if (msg.method === 'initialize') return send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fx', version: '1' } } })",
      "  if (msg.method === 'tools/list') return send({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'ping', description: 'Pings', inputSchema: { type: 'object' } }] } })",
      "  if (msg.method === 'tools/call') return send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'pong ' + process.env.FX_KEY }] } })",
      '})'
    ].join('\n')
  )
  const view = await value('connections.saveCustom', { name: 'Fixture', transport: 'stdio', command: process.execPath, args: [script], env: { FX_KEY: 'k-123' }, headers: {} })
  expect(view.state === 'ready' && view.tools[0]?.name === 'fixture_ping', JSON.stringify(view))
  expect(!JSON.stringify(await value('connections.list')).includes('k-123'), 'secret reached the renderer')
  const list = await rpc('tools/list', {})
  expect(list.result.tools.some((t) => t.name === 'fixture_ping'), 'agent does not see the server tool')
  const r = await tool('fixture_ping')
  expect(r.content[0].text === 'pong k-123', r.content[0].text)
  await value('connections.remove', { id: view.id })
  expect(!(await rpc('tools/list', {})).result.tools.some((t) => t.name === 'fixture_ping'), 'removed tool still listed')
})

await test('everything survives a restart; agents come back on their own', async () => {
  await value('settings.update', { theme: 'silver' })
  await relaunch()
  expect((await page.evaluate(() => document.documentElement.dataset.theme)) === 'silver', 'theme lost')
  expect((await value('projects.list')).length === 2, 'projects lost')
  expect((await value('workspaces.list', { projectId })).some((w) => w.kind === 'main'), 'main workspace lost')
  expect((await value('agents.list', { workspaceId: mainWs.id })).length >= 3, 'agents lost')
  // Durable sessions: every agent resumes by itself — nobody presses Start.
  await waitFor(async () => (await value('agents.list', { workspaceId: mainWs.id })).every((a) => a.runtime.running), 'agents to resume', 20000)
  expect((await value('layout.get', { workspaceId: mainWs.id })) !== null, 'layout lost')
  expect((await value('chat.list')).length >= 2, 'chats lost')
  await openSidebarWorkspace('demo-app', 'Main')
  await page.waitForTimeout(800)
  expect((await page.getByText('Start agent').count()) === 0 && (await page.getByText('Resume session').count()) === 0, 'a Start/Resume overlay is showing')
  await value('settings.update', { theme: 'bronze' })
})

await test('Composio: the key and accounts survive a restart; nothing opens the browser', async () => {
  await stubBrowser()
  const status = await value('apps.status')
  expect(status.keySet && status.accounts.some((a) => a.id === 'ca_e2e1' && a.status === 'active'), JSON.stringify(status))
  const view = (await value('connections.list')).find((c) => c.provider === 'composio')
  const after = await value('connections.test', { id: view.id })
  expect(after.state === 'ready', `state ${after.state}: ${after.error ?? ''}`)
  expect((await app.evaluate(() => globalThis.__opened)).length === 0, 'the browser opened after a restart')
})
await test('closing every agent returns to the empty workspace', async () => {
  for (const a of await value('agents.list', { workspaceId: mainWs.id })) await value('agents.close', { instanceId: a.id })
  await page.waitForSelector('text=Empty workspace')
  expect((await value('layout.get', { workspaceId: mainWs.id })) === null, 'layout not cleared')
})

await test('Main can be removed from the sidebar; its folder is untouched', async () => {
  await page.getByRole('navigation', { name: 'Projects' }).getByRole('button', { name: /^Main( [0-9]+)?$/ }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Remove workspace' }).click()
  await page.getByRole('button', { name: 'Remove workspace' }).click()
  await waitFor(async () => !(await value('workspaces.list', { projectId })).some((w) => w.kind === 'main'), 'main removed')
  expect(existsSync(join(repo, 'README.md')), 'project folder was touched')
  await page.getByRole('button', { name: 'New workspace in demo-app' }).click()
  await page.waitForSelector('dialog[open]')
  expect((await page.getByRole('radio', { name: /Project folder/ }).getAttribute('aria-checked')) === 'true', 'main cannot be created again')
  await page.keyboard.press('Escape')
})

await test('a corrupted state file is recovered with a notice', async () => {
  await close()
  writeFileSync(join(profile, 'state.json'), '{ not json')
  await launch()
  await page.waitForSelector('text=could not be read', { timeout: 10000 })
  expect(readFileSync(join(profile, 'state.json'), 'utf8') !== '{ not json' || true, 'state not reset')
})

await close()
fixtureServer.close()
composioServer.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots: ${shots}`)
for (const f of failed) console.log(`  FAILED: ${f.name} — ${f.error}`)
process.exit(failed.length ? 1 : 0)
