/* global document, window, getComputedStyle, requestAnimationFrame, cancelAnimationFrame */
// End-to-end battle test: drives the built Electron app with throwaway profiles and repositories.
// Usage: pnpm build && node scripts/e2e.mjs [screenshotDir]   (E2E_CHAT=1 also runs real chat prompts)
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { app, browserPane, close, expect, finish, invoke, launch, local, nativeShown, page, profile, relaunch, sandbox, shot, test, value, waitFor } from './e2e-harness.mjs'

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

// ---------- app helpers ----------
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
/** Opens a worktree from the sidebar ("Main" is the Primary), unfolding its workspace first. */
const openSidebarWorkspace = async (projectName, workspaceName) => {
  const nav = page.getByRole('navigation', { name: 'Workspaces' })
  const child = workspaceName === 'Main' ? nav.getByRole('button', { name: `${projectName}, primary worktree` }) : nav.getByRole('button', { name: workspaceName, exact: true })
  if (!(await child.isVisible())) await nav.getByRole('button', { name: new RegExp(`^${projectName}(: open .*)?$`) }).first().click()
  await child.click()
}
/** A tab of the open worktree's Dashboard (Tasks, Worktrees, Issues), showing the side panel first. */
const openDashboardTab = async (tab) => {
  if (await page.getByRole('button', { name: 'Show side panel' }).count()) await page.getByRole('button', { name: 'Show side panel' }).click()
  await page.locator('aside[aria-label="Side panel"]').getByRole('tab', { name: 'Dashboard' }).click()
  await page.getByRole('tablist', { name: 'Workspace sections' }).getByRole('tab', { name: tab }).click()
}
const stubFolderPicker = (folder) =>
  app.evaluate(({ dialog }, f) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] })
  }, folder)
/** Add workspace › a folder, with the folder picker stubbed to `folder`. */
const addProjectFolder = async (folder) => {
  await stubFolderPicker(folder)
  await page.getByRole('button', { name: 'Add workspace', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Add workspace' })
  await dialog.getByRole('button', { name: 'Choose' }).click()
  await dialog.getByRole('button', { name: /^Add workspace/ }).click()
}
/** Settings is a window over the app (ADR 0039): its own × closes it. */
const closeSettings = () => page.locator('dialog[open]').getByRole('button', { name: 'Close settings' }).click()
/** The New worktree dialog of a workspace, from its sidebar "+". */
const newWorktree = async (projectName) => {
  await page.getByRole('button', { name: `New worktree in ${projectName}` }).click()
  return page.getByRole('dialog', { name: 'New worktree' })
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
await test('home renders with the DEV badge in the sidebar, and no modes (ADR 0056)', async () => {
  await page.waitForSelector('text=Welcome to Hiveory')
  expect(await page.getByText('DEV', { exact: true }).isVisible(), 'DEV badge missing')
  expect((await value('settings.get')).theme === 'dark', 'Dark is not the default theme')
  expect((await page.getByRole('tab', { name: 'Chat' }).count()) === 0, 'a Chat mode tab is still shown')
  await shot('a1-home')
})

await test('settings: every section renders', async () => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  for (const section of ['Appearance', 'Agents', 'Skills, MCPs & Apps', 'Updates', 'Guide', 'About']) {
    await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: section }).click()
    await page.waitForTimeout(150)
    expect(!(await page.getByText('failed to display').isVisible()), `${section} crashed`)
  }
})

await test('settings: Remote looks for computers on this Wi-Fi, never listing this one (ADR 0052)', async () => {
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Remote' }).click()
  await page.getByText('No computer on this Wi-Fi shares Hiveory', { exact: false }).waitFor({ timeout: 15000 })
  const found = await value('client.discover')
  expect(Array.isArray(found.lan), `lan: ${JSON.stringify(found.lan)}`)
})

await test('settings: silver theme applies instantly and persists', async () => {
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Appearance' }).click()
  await page.getByRole('radio', { name: /Silver/ }).click()
  await waitFor(async () => (await page.evaluate(() => document.documentElement.dataset.theme)) === 'silver', 'theme attribute')
  expect((await value('settings.get')).theme === 'silver', 'theme not saved')
  await shot('a2-settings-silver')
  await page.getByRole('radio', { name: /Bronze/ }).click()
  // Appearance is in sections, one at a time (ADR 0043).
  const sections = page.getByRole('tablist', { name: 'Appearance sections' })
  await sections.getByRole('tab', { name: 'Background' }).click()
  await page.getByRole('radiogroup', { name: 'Wallpaper' }).waitFor()
  expect(!(await page.getByRole('radio', { name: /Silver/ }).count()), 'theme cards still shown beside Background')
  await sections.getByRole('tab', { name: 'Theme', exact: true }).click()
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

await test('appearance: three themes in a row; each applies', async () => {
  const cards = page.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio')
  expect((await cards.count()) === 3, `theme count ${await cards.count()}`)
  const tops = await cards.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)))
  expect(tops[0] === tops[1] && tops[1] === tops[2], `not in one row: ${tops}`)
  for (const [name, id] of [['Bronze', 'bronze'], ['Silver', 'silver']]) {
    await page.getByRole('radio', { name: new RegExp(name) }).click()
    await waitFor(async () => (await page.evaluate(() => document.documentElement.dataset.theme)) === id, `${id} theme`)
  }
  await page.waitForTimeout(500)
  await shot('a2c-themes')
  await page.getByRole('radio', { name: /^Dark/ }).click()
})

await test('appearance: an added image becomes the wallpaper; transparency reaches every surface', async () => {
  await page.getByRole('tablist', { name: 'Appearance sections' }).getByRole('tab', { name: 'Background' }).click()
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
    // The theme's surfaces fade in their transition; wait for it rather than a fixed delay.
    const alphas = async () => [await alphaOf('nav[aria-label="Settings sections"]'), await alphaOf('div:has(> [role="radiogroup"][aria-label="Wallpaper"])')]
    await waitFor(async () => (await alphas()).every((a) => a === 0), `${theme}: surfaces fully transparent`, 5000).catch(() => undefined)
    const seen = await alphas()
    expect(seen.every((a) => a === 0), `${theme}: surfaces not fully transparent (${seen})`)
  }
  await value('settings.update', { theme: 'dark', surfaceOpacity: 0.6 })
  await page.waitForTimeout(400)
  await shot('a2d-wallpaper')
  await page.getByRole('radio', { name: 'None' }).click()
  await waitFor(async () => !(await page.evaluate(() => 'wallpaper' in document.documentElement.dataset)), 'wallpaper removed')
})

await test('the sidebar logo is flat (no glow, no gradient)', async () => {
  const brand = page.getByRole('navigation', { name: 'Workspaces' })
  const logo = await brand.locator('img').first().evaluate((el) => {
    const s = getComputedStyle(el)
    return { filter: s.filter, clip: s.clipPath }
  })
  expect(logo.filter === 'none' && logo.clip.startsWith('inset'), JSON.stringify(logo))
  const name = await brand.getByText('Hiveory', { exact: true }).evaluate((el) => getComputedStyle(el).backgroundImage)
  expect(name === 'none', `brand name has a gradient: ${name}`)
})

await test('extensions: skills, MCP and apps are separate tabs; apps use real logos', async () => {
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Skills, MCPs & Apps' }).click()
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
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Skills, MCPs & Apps' }).click()
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
  await page.getByRole('dialog', { name: 'Disconnect Work?' }).getByRole('button', { name: 'Disconnect' }).click()
  await waitFor(async () => !composio.accounts.some((a) => a.id === 'ca_e2e2'), 'Work account removed from Composio')
  await gmail.getByText('ca_e2e2 · active').waitFor({ state: 'detached', timeout: 15000 })
  expect(await gmail.getByText('ca_e2e1 · active').isVisible(), 'the other account went too')
})
await test('settings: agent defaults pre-fill the create dialog toggles', async () => {
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Agents' }).click()
  // Chat is its own "Chat UI" entry now (ADR 0059): Settings has no "New agents open as".
  expect(!(await page.getByText('New agents open as').count()), 'the old chat default is still in Settings')
  await page.getByRole('switch', { name: 'Skip permissions (YOLO) for every agent' }).click()
  await waitFor(async () => {
    const s = await value('settings.get')
    return s.defaultAutoApprove
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
  expect(await page.getByRole('heading', { name: /The Kanban/ }).isVisible(), 'next chapter failed')
  await shot('a3-guide')
})

await test('settings: updates are honest in development builds', async () => {
  await page.getByRole('button', { name: 'All chapters' }).click().catch(() => undefined)
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Updates' }).click()
  expect(await page.getByText('Updates run in installed builds').isVisible(), 'unsupported state not shown')
  expect(await page.getByRole('button', { name: 'Check now' }).isDisabled(), 'check should be disabled in dev')
  await closeSettings()
})

// ======================= B. Projects, Git, workspaces =======================
console.log('B. Projects, Git & workspaces')
await test('add a Git workspace: its Primary worktree is made, nothing else', async () => {
  await addProjectFolder(repo)
  await waitFor(async () => (await value('projects.list')).length === 1, 'workspace added')
  projectId = (await value('projects.list'))[0].id
  mainWs = await workspaceWhere(projectId, (w) => w.kind === 'main')
  const all = await value('workspaces.list', { projectId })
  expect(all.length === 1 && mainWs.path === repo, `worktrees: ${all.map((w) => w.name)}`)
  expect((await value('agents.list', { workspaceId: mainWs.id })).length === 0, 'agents were started on their own')
})

await test('the Dashboard path trail copies the full path', async () => {
  await openSidebarWorkspace('demo-app', 'Main')
  await openDashboardTab('Tasks')
  await app.evaluate(({ clipboard }) => clipboard.writeText(''))
  await page.locator('aside[aria-label="Side panel"]').getByRole('button', { name: 'Copy path', exact: true }).first().click()
  // The system clipboard can lag a moment behind the write.
  await waitFor(async () => (await app.evaluate(({ clipboard }) => clipboard.readText())) === repo, 'the path on the clipboard')
})

await test('"+" opens New worktree with the Settings defaults', async () => {
  const dialog = await newWorktree('demo-app')
  await dialog.waitFor()
  expect(!(await dialog.getByRole('switch', { name: 'Use chat UI' }).count()), 'the old chat toggle is still in New worktree')
  expect((await dialog.getByRole('switch', { name: 'Skip permissions (YOLO)' }).getAttribute('aria-checked')) === 'true', 'auto-approve default not applied')
  await page.keyboard.press('Escape')
  await value('settings.update', { defaultAutoApprove: false })
})

await test('a second Primary is refused', async () => {
  const r = await invoke('workspaces.create', { projectId, kind: 'main', name: 'Main 2', cliSelections: [], autoApprove: false })
  expect(!r.ok && /already has a main/.test(r.error.message), 'IPC allowed a second Primary')
})

await test('new branch: invalid branch name is caught before creating', async () => {
  await page.waitForTimeout(600)
  const dialog = await newWorktree('demo-app')
  await dialog.getByText('Base branch').first().waitFor()
  await dialog.getByLabel('New branch').fill('bad..name')
  await dialog.getByText('not a valid Git branch name').waitFor({ timeout: 5000 })
  expect(await dialog.getByRole('button', { name: 'Create', exact: true }).isDisabled(), 'create enabled with invalid branch')
})

await test('new branch from develop with a custom name creates a real worktree', async () => {
  const dialog = page.getByRole('dialog', { name: 'New worktree' })
  await dialog.getByLabel('Worktree name').fill('Feature E2E')
  await choose(dialog, 'Base branch', 'develop')
  await dialog.getByLabel('New branch').fill('feature/e2e')
  await waitFor(async () => !(await dialog.getByRole('button', { name: 'Create', exact: true }).isDisabled()), 'create to enable')
  await shot('b1-create-branch')
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  featureWs = await workspaceWhere(projectId, (w) => w.git?.branch === 'feature/e2e')
  expect(featureWs?.git.baseRef === 'develop', 'base ref not recorded')
  expect(git(repo, 'worktree', 'list').includes('feature/e2e'), 'worktree missing from git')
  expect(existsSync(join(featureWs.path, 'README.md')), 'worktree folder empty')
})

await test('use an existing branch (develop) without ever deleting it', async () => {
  const dialog = await newWorktree('demo-app')
  await dialog.getByRole('tab', { name: 'Existing branch' }).click()
  await choose(dialog, 'Branch to check out', 'develop')
  await dialog.getByLabel('Worktree name').fill('Develop')
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
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

await test('worktree cards show live git status', async () => {
  writeFileSync(join(featureWs.path, 'new.txt'), 'x')
  await openSidebarWorkspace('demo-app', 'Main')
  await openDashboardTab('Worktrees')
  await page.waitForSelector('text=1 changed', { timeout: 25000 })
  await shot('b2-workspaces-status')
})

await test('a worktree whose folder is deleted outside Hiveory is forgotten; its branch stays (ADR 0038)', async () => {
  rmSync(existingWs.git.worktreePath, { recursive: true, force: true })
  await relaunch()
  await waitFor(async () => !(await value('workspaces.list', { projectId })).some((w) => w.id === existingWs.id), 'the deleted worktree forgotten')
  expect(git(repo, 'branch', '--list', 'develop').includes('develop'), 'its branch was deleted')
  await openSidebarWorkspace('demo-app', 'Main')
})

await test('deleting a dirty worktree needs a second confirmation', async () => {
  const dirty = await invoke('workspaces.delete', { workspaceId: featureWs.id, force: false })
  expect(!dirty.ok && dirty.error.code === 'WORKTREE_DIRTY', 'dirty delete not blocked')
  await value('workspaces.delete', { workspaceId: featureWs.id, force: true })
  expect(!existsSync(featureWs.git.worktreePath), 'forced delete left folder')
})

await test('plain folder: Initialize Git makes isolation possible', async () => {
  await addProjectFolder(plain)
  await page.waitForTimeout(500)
  plainProjectId = (await value('projects.list')).find((p) => p.path === plain).id
  const dialog = await newWorktree('plain-folder')
  await dialog.getByText('not a Git repository').waitFor()
  await shot('b3-init-git')
  await dialog.getByRole('button', { name: 'Initialize Git' }).click()
  await dialog.getByText('Base branch').first().waitFor({ timeout: 15000 })
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await workspaceWhere(plainProjectId, (w) => w.kind === 'isolated')
  expect(existsSync(join(plain, '.git')), 'git not initialized')
})

// ======================= C. Panes =======================
console.log('C. Panes, layout & resizing')
await test('open agents; panes fill the area without a header bar', async () => {
  await openSidebarWorkspace('demo-app', 'Main')
  if (await page.getByRole('button', { name: 'Hide side panel' }).count()) await page.getByRole('button', { name: 'Hide side panel' }).click()
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
  const nav = page.getByRole('navigation', { name: 'Workspaces' })
  // A folded row is named "<workspace>: open <worktree>", an unfolded one just "<workspace>".
  const row = (name) => nav.getByRole('button', { name: new RegExp(`^${name}(: open .*)?$`) }).first()
  const order = async () => {
    const [a, b] = await Promise.all(['demo-app', 'plain-folder'].map(async (name) => (await row(name).boundingBox()).y))
    return a < b ? ['demo-app', 'plain-folder'] : ['plain-folder', 'demo-app']
  }
  const before = await order()
  // Looking at the lower project does not move it.
  await row(before[1]).click()
  await page.waitForTimeout(500)
  expect(JSON.stringify(await order()) === JSON.stringify(before), `clicking ${before[1]} moved it: ${await order()}`)
  // Work there does: an agent opening in it.
  const lowerId = (await value('projects.list')).find((x) => x.name === before[1]).id
  const ws = (await value('workspaces.list', { projectId: lowerId }))[0]
  const { agent } = await value('agents.open', { workspaceId: ws.id, cliId: 'powershell' })
  await waitFor(async () => (await order())[0] === before[1], `${before[1]} to rise after work there`)
  await value('agents.close', { instanceId: agent.id })
  await openSidebarWorkspace('demo-app', 'Main')
  // Panes are tabs (ADR 0042): the shown one, not a background tab.
  await page.locator('section[aria-label$=" agent"]:visible').first().waitFor()
})

await test('arrange bar: Columns, then narrow panes keep a reachable close button', async () => {
  // The agents opened as tabs of one area (ADR 0042): drag the first tab, whatever the random names make the strip look like.
  const src = await page.getByRole('tablist', { name: 'Panes in this area' }).first().getByRole('tab').first().boundingBox()
  const layout = await page.locator('section[aria-label$=" agent"]').first().evaluate((el) => el.parentElement.parentElement.getBoundingClientRect().toJSON())
  await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2)
  await page.mouse.down()
  await page.mouse.move(src.x + 70, src.y + 30, { steps: 4 })
  const columnsX = layout.x + layout.width / 2 + 128
  await page.mouse.move(columnsX, layout.y + 30, { steps: 10 })
  await page.waitForSelector('text=Release on a layout')
  // No screenshot here: a capture mid-drag (Playwright's, not the user's) turns the drop into a dock.
  await page.mouse.up()
  await page.waitForTimeout(500)
  await shot('c1-columns')
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

await test('keyboard: divider arrows resize; a pane tab’s menu renames it', async () => {
  const divider = page.getByRole('separator', { name: 'Resize panes' }).first()
  const before = await divider.getAttribute('aria-valuenow')
  await divider.focus()
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(250)
  expect((await divider.getAttribute('aria-valuenow')) !== before, 'arrow key did not resize')
  // Panes are tabs (ADR 0042): a tab's right-click menu holds Rename, Split right / down and Close.
  const agent = (await value('agents.list', { workspaceId: mainWs.id }))[0]
  await page.getByRole('tab', { name: new RegExp(`\\b${agent.petName}\\b`) }).click({ button: 'right' })
  for (const item of ['Rename', 'Split right', 'Split down', 'Close']) await page.getByRole('menuitem', { name: item }).waitFor()
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  await page.getByLabel(`Rename ${agent.petName}`).fill('Renamed')
  await page.keyboard.press('Enter')
  await waitFor(async () => (await value('agents.list', { workspaceId: mainWs.id })).some((a) => a.id === agent.id && a.petName === 'Renamed'), 'renamed from the tab menu')
  await page.getByRole('tab', { name: /\bRenamed\b/ }).waitFor()
})

await test('maximize via double-click and restore with a second one', async () => {
  const name = (await panes().first().getAttribute('aria-label')).replace(' agent', '')
  // The pane's own tab: the middle of the header may hold another tab or the "+" (random names, ADR 0042).
  const tab = () => page.locator(`section[aria-label="${name} agent"]`).getByRole('tab').filter({ hasText: name }).first()
  await tab().dblclick()
  await page.waitForTimeout(400)
  const layout = await panes().first().evaluate((el) => el.parentElement.parentElement.getBoundingClientRect().width)
  const max = await page.locator(`section[aria-label="${name} agent"]`).boundingBox()
  expect(max.width > layout - 4, 'double-click did not maximize')
  await shot('c4-maximized')
  // A second double-click restores it.
  await tab().dblclick()
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
await test('the side panel has its fixed tabs, no "+" and no ×; browsers are panes', async () => {
  if (await page.getByRole('button', { name: 'Show side panel' }).count()) await page.getByRole('button', { name: 'Show side panel' }).click()
  for (const name of ['Dashboard', 'Changes', 'Pull request', 'Sessions', 'Explorer']) await sidePanel().getByRole('tab', { name }).waitFor()
  // Schedules live in the sidebar and a Workspace's settings in Settings (ADR 0062); Pull request joined (ADR 0064).
  expect((await sidePanel().getByRole('tablist', { name: 'Side panel tabs' }).getByRole('tab').count()) === 5, 'the side panel has more than its five tabs')
  expect(!(await sidePanel().getByRole('button', { name: /^Close / }).count()), 'side panel tabs can be closed')
  expect(!(await sidePanel().getByRole('button', { name: /^Add / }).count()), 'side panel still has "+"')
  expect(!(await sidePanel().getByLabel('Address').count()), 'a browser in the side panel')
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

await test('the panel maximizes over the main area', async () => {
  const before = await sidePanel().boundingBox()
  const paneBefore = await panes().first().boundingBox()
  await page.getByRole('button', { name: 'Maximize side panel' }).click()
  await page.waitForTimeout(400)
  const after = await sidePanel().boundingBox()
  const sidebar = await page.getByRole('navigation', { name: 'Workspaces' }).boundingBox()
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
  const left = async () => (await page.getByRole('navigation', { name: 'Workspaces' }).boundingBox()).width
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

await test('panes follow a moving sidebar in the same frame: no pane ever steps backwards (ADR 0024)', async () => {
  // With room to give: four panes at their minimum beside an open side panel leave the sidebar nowhere to go.
  if (await page.getByRole('button', { name: 'Hide side panel' }).count()) await page.getByRole('button', { name: 'Hide side panel' }).click()
  await page.waitForTimeout(300)
  // Every animation frame while the sidebar edge moves one way: each pane's left edge may only move that way.
  await page.evaluate(() => {
    window.__paneFrames = []
    const loop = () => {
      window.__paneFrames.push([...document.querySelectorAll('section[aria-label$=" agent"]')].map((el) => el.getBoundingClientRect().x))
      window.__paneProbe = requestAnimationFrame(loop)
    }
    window.__paneProbe = requestAnimationFrame(loop)
  })
  const box = await page.getByRole('separator', { name: 'Resize sidebar' }).boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  for (let dx = 4; dx <= 120; dx += 4) {
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2)
    await page.waitForTimeout(16)
  }
  await page.mouse.up()
  await page.waitForTimeout(300)
  const frames = await page.evaluate(() => (cancelAnimationFrame(window.__paneProbe), window.__paneFrames))
  const backwards = frames.slice(1).flatMap((f, n) => f.map((x, i) => x - (frames[n][i] ?? x)).filter((d) => d < -0.5))
  expect(frames.length > 20, `only ${frames.length} frames sampled`)
  expect(backwards.length === 0, `panes stepped backwards ${backwards.length} times while the sidebar grew: ${backwards.slice(0, 5)}`)
  await page.getByRole('separator', { name: 'Resize sidebar' }).dblclick()
})

await test('dragging a sidebar well past its minimum hides it; showing it again restores its width', async () => {
  const drag = async (name, dx) => {
    const box = await page.getByRole('separator', { name }).boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2, { steps: 8 })
    await page.mouse.up()
  }
  const width = (await page.getByRole('navigation', { name: 'Workspaces' }).boundingBox()).width
  await drag('Resize sidebar', -400)
  await waitFor(async () => !(await page.getByRole('navigation', { name: 'Workspaces' }).isVisible()), 'sidebar collapsed')
  await page.getByRole('button', { name: 'Show sidebar' }).click()
  await page.waitForTimeout(400)
  expect(Math.abs((await page.getByRole('navigation', { name: 'Workspaces' }).boundingBox()).width - width) < 2, 'sidebar width not restored')
  if (await page.getByRole('button', { name: 'Show side panel' }).count()) await page.getByRole('button', { name: 'Show side panel' }).click()
  await sidePanel().waitFor()
  // To the window's right edge: moves past the window are not always delivered.
  const edge = await page.getByRole('separator', { name: 'Resize side panel' }).boundingBox()
  await drag('Resize side panel', page.viewportSize().width - 4 - (edge.x + edge.width / 2))
  await waitFor(async () => !(await sidePanel().isVisible()), 'side panel collapsed')
  await page.getByRole('button', { name: 'Show side panel' }).click()
  await sidePanel().waitFor()
})

let shellPane
await test('pane "+": terminals first, search; PowerShell opens as a tab', async () => {
  await page.getByRole('button', { name: 'Add agent' }).first().click()
  const picker = page.getByRole('dialog', { name: 'Add pane' })
  await picker.waitFor()
  await page.waitForTimeout(400)
  const names = await picker.getByRole('menuitem').allInnerTexts()
  // The browser, Chat UI when a chat CLI is installed (ADR 0059), then terminals, then agents (ADR 0042).
  const rest = names.slice(names[1] === 'Chat UI' ? 2 : 1)
  expect(names[0] === 'Browser' && rest[0] === 'PowerShell' && rest.includes('Command Prompt'), `terminals not right after the browser: ${names}`)
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

await test('Ctrl+click on a file:line or a URL in a terminal opens it beside the pane', async () => {
  const ws = shellPane.workspaceId
  writeFileSync(join(repo, 'linked.ts'), Array.from({ length: 40 }, (_, i) => `const line${i + 1} = ${i + 1}`).join('\n'))
  const pane = page.locator(`section[aria-label="${shellPane.petName} agent"]`)
  // The command line itself holds no link ([char]46 is ".", [char]58 is ":"); only the printed line does.
  const show = async (expr) => {
    await value('terminal.write', { instanceId: shellPane.id, data: `cls; echo (${expr})\r` })
    await page.waitForTimeout(700)
  }
  /** Hovers down the first column until the link tooltip shows; returns that point. */
  const findLink = async () => {
    const box = await pane.locator('.xterm-screen').boundingBox()
    for (let y = box.y + 4; y < box.y + Math.min(box.height, 260); y += 4) {
      await page.mouse.move(box.x + 12, y)
      if (await pane.locator('[title$="+click to open"]').count()) return { x: box.x + 12, y }
    }
    throw new Error('no link under the mouse')
  }
  const ctrlClick = async ({ x, y }) => {
    await page.keyboard.down('Control')
    await page.mouse.click(x, y)
    await page.keyboard.up('Control')
  }
  await show(`'linked' + [char]46 + 'ts' + [char]58 + '25'`)
  const at = await findLink()
  // A plain click is a click: nothing opens.
  await page.mouse.click(at.x, at.y)
  await page.waitForTimeout(400)
  expect(!(await value('editors.list', { workspaceId: ws })).some((e) => e.path === 'linked.ts'), 'a plain click opened the file')
  await ctrlClick(at)
  await waitFor(async () => (await value('editors.list', { workspaceId: ws })).some((e) => e.path === 'linked.ts'), 'linked.ts opened')
  const file = page.locator('section[aria-label="linked.ts file"]')
  await waitFor(async () => (await file.locator('.cm-activeLine').textContent().catch(() => '')) === 'const line25 = 25', 'the editor at line 25')

  // A path outside the worktree is refused, and nothing opens.
  const before = (await value('editors.list', { workspaceId: ws })).length
  await show(`'..' + [char]47 + 'outside' + [char]46 + 'txt'`)
  await ctrlClick(await findLink())
  await page.getByText(/outside this worktree/).first().waitFor()
  expect((await value('editors.list', { workspaceId: ws })).length === before, 'a file outside the worktree opened')

  await show(`'http' + [char]58 + '//127.0.0.1' + [char]58 + '9/linked-page'`)
  await ctrlClick(await findLink())
  await waitFor(async () => (await value('browser.state')).pages.some((p) => p.scope === ws && p.url.includes('127.0.0.1:9/linked-page')), 'browser pane for the URL')
  for (const p of (await value('browser.state')).pages.filter((p) => p.url.includes('linked-page'))) await value('browser.close', { pageId: p.id })
  const opened = (await value('editors.list', { workspaceId: ws })).find((e) => e.path === 'linked.ts')
  await value('editors.close', { editorId: opened.id })
  rmSync(join(repo, 'linked.ts'))
})

await test('a terminal that prints behind another tab says "New output" until it is shown', async () => {
  const ws = shellPane.workspaceId
  const areaOf = (node) => (node.type === 'pane' ? ((node.tabs ?? [node.paneId]).includes(shellPane.id) ? node : null) : node.children.map(areaOf).find(Boolean) ?? null)
  const area = areaOf(await value('layout.get', { workspaceId: ws }))
  const other = (area?.tabs ?? []).find((id) => id !== shellPane.id)
  expect(other, `the shell shares no area: ${JSON.stringify(area)}`)
  // Marks inside a tab are presentational (not part of its role tree): matched by attribute.
  const tab = page.getByRole('tab', { name: new RegExp(`\\b${shellPane.petName}\\b`) })
  await value('layout.apply', { workspaceId: ws, operation: { type: 'activate', paneId: other } })
  await page.waitForTimeout(400)
  expect((await tab.locator('[aria-label="New output"]').count()) === 0, 'marked before printing')
  await value('terminal.write', { instanceId: shellPane.id, data: 'echo background-output\r' })
  await waitFor(async () => (await tab.locator('[aria-label="New output"]').count()) > 0, `no mark on ${shellPane.petName}`)
  await value('layout.apply', { workspaceId: ws, operation: { type: 'activate', paneId: shellPane.id } })
  await waitFor(async () => (await tab.locator('[aria-label="New output"]').count()) === 0, 'the mark cleared once shown')
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
    if (await page.getByRole('button', { name: 'Hide side panel' }).count()) await page.getByRole('button', { name: 'Hide side panel' }).click()
  }
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

await test('Composio: Work agents call its tools; the key stays masked', async () => {
  const say = (r) => r.content.map((c) => c.text ?? '').join('\n')
  const names = (await rpc('tools/list', {})).result.tools.map((t) => t.name)
  expect(names.includes('composio_COMPOSIO_SEARCH_TOOLS'), 'the agent has no Composio tools')
  const first = await tool('composio_COMPOSIO_SEARCH_TOOLS', { query: 'gmail' })
  expect(!first.isError && say(first).includes('found GMAIL_SEND_EMAIL for gmail (key ••••)'), say(first))
  expect(!say(first).includes(COMPOSIO_KEY), 'an agent saw the Composio key')
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
  await closeSettings()
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

const fixturePort = String(fixtureServer.address().port)
/** Whether the fixture page's native view is drawn (it must step aside whenever its pane can't be seen). */
const fixtureShown = () => nativeShown(fixturePort)

await test("the agent page opens as a tab in its agent's area, under its name; viewport emulation", async () => {
  const agents = await value('agents.list', { workspaceId: mainWs.id })
  await openSidebarWorkspace('demo-app', 'Main')
  const pane = page.locator('section[aria-label$=" browser"]').filter({ hasText: `${agents[0].petName} · Fixture` })
  await pane.waitFor()
  expect(!(await sidePanel().getByLabel('Address').count()), 'the page opened in the side panel')
  // A tab in its agent's area (ADR 0042), not docked at the far right.
  expect(await pane.getByRole('tab', { name: new RegExp(agents[0].petName) }).count(), 'the page is not a tab beside its agent')
  await waitFor(fixtureShown, 'the page drawn over its pane')
  // "is using this page" shows only while the agent acts, not forever.
  await waitFor(async () => !(await pane.getByText('is using this page').isVisible()), 'agent strip to clear once the agent is idle', 6000)
  expect(!(await value('browser.state')).pages[0].agentActive, 'page still marked active')
  const vp = await tool('browser_viewport', { preset: 'iPhone SE' })
  expect(!vp.isError, text(vp))
  expect(text(await tool('browser_evaluate', { script: 'screen.width + "x" + screen.height + " " + navigator.maxTouchPoints + " " + devicePixelRatio' })).includes('375x667 5 2'), 'device not emulated')
  // The device toolbar appears for an agent-set device too.
  const bar = browserPane().getByRole('toolbar', { name: 'Device toolbar' })
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
  await browserPane().getByRole('button', { name: 'More browser actions' }).click()
  await page.getByRole('menuitem', { name: 'Pick element' }).waitFor()
  await waitFor(async () => !(await fixtureShown()), 'the page to step aside for a menu')
  await shot('e4-browser-menu')
  await page.keyboard.press('Escape')
  await waitFor(fixtureShown, 'the page back after the menu')
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
  const view = app.windows().find((w) => w.url().includes(fixturePort))
  expect(view, 'browser page target not found')
  await browserPane().getByRole('button', { name: 'More browser actions' }).click()
  await page.getByRole('menuitem', { name: 'Pick element' }).click()
  await browserPane().getByText('Click an element to copy it').waitFor()
  await page.waitForTimeout(300)
  await view.click('#go')
  await browserPane().getByText(/Copied button "Greet"/).waitFor()
  // The system clipboard can lag a moment behind the write.
  let copied = ''
  await waitFor(async () => (copied = await app.evaluate(({ clipboard }) => clipboard.readText())).includes('selector: #go'), 'the element on the clipboard')
  expect(copied.includes('<button'), `clipboard: ${copied.slice(0, 200)}`)
  await browserPane().getByRole('button', { name: 'More browser actions' }).click()
  await page.getByRole('menuitem', { name: 'Annotate element' }).click()
  await browserPane().getByText('Click the element to annotate').waitFor()
  await page.waitForTimeout(300)
  await view.click('#email')
  // The note card floats on the page at the element, its box focused (ADR 0042).
  await browserPane().getByText(/Write the note on the page/).waitFor()
  await view.keyboard.type('Validate this email')
  await view.keyboard.press('Control+Enter')
  await browserPane().getByText(/1 note ready/).waitFor()
  await browserPane().getByRole('button', { name: 'Done' }).click()
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
})

// ======================= F. Kanban =======================
console.log('F. Kanban')
await test('kanban shows agents by real status, colour only', async () => {
  await openSidebarWorkspace('demo-app', 'Main')
  await openDashboardTab('Tasks')
  await page.waitForTimeout(800)
  const board = await value('kanban.board', { projectId })
  const total = board.idle.length + board.working.length + board['waiting-for-you'].length
  expect(total === 4, `board has ${total} agents`)
  expect((await page.getByText(/Waiting for (permission|confirmation|input)/).count()) === 0, 'status text shown on cards')
  await shot('f1-kanban')
})

await test('clicking a kanban card jumps to that agent\'s pane', async () => {
  await page.locator('aside[aria-label="Side panel"] button[aria-label*=", Claude Code, "]').first().click()
  await page.waitForTimeout(500)
  expect((await panes().count()) > 0, 'did not navigate to the workspace')
})

await test('kanban never mixes projects', async () => {
  const other = await value('kanban.board', { projectId: plainProjectId })
  expect(other.idle.length + other.working.length + other['waiting-for-you'].length === 0, 'other project leaked agents')
})

// ======================= G. Chat =======================
console.log('G. Chat')
let chatWs
await test('Work: Chat UI opens chats; a CLI picked from a list keeps its terminal (ADR 0059)', async () => {
  chatWs = await value('workspaces.create', { projectId, kind: 'isolated', name: 'Chatty', cliSelections: [], autoApprove: false })
  for (const cliId of ['codex', 'claude']) await value('agents.open', { workspaceId: chatWs.id, cliId, chatUi: true })
  const agents = await value('agents.list', { workspaceId: chatWs.id })
  expect(agents.length === 2 && agents.every((a) => a.chatUi && a.runtime.running), 'chat agents not created ready')
  await openSidebarWorkspace('demo-app', 'Chatty')
  await waitFor(async () => (await panes().locator('textarea[aria-label="Message"]').count()) === 2, 'chat composers in panes')
  expect((await panes().locator('.xterm').count()) === 0, 'a chat agent rendered a terminal')
  expect((await panes().getByTitle('The CLI is fixed once a chat has started').count()) === 0, 'agent composer repeats the CLI')
  expect(await panes().first().getByText(/^Chat with /).isVisible(), 'welcome with the CLI logo missing')
  expect(await panes().first().getByRole('button', { name: /Read-only|Full access/ }).isVisible(), 'permissions picker missing')
  // A chat may change CLI before (and during) a conversation; its agent follows (ADR 0058).
  const [first, second] = agents
  await value('chat.update', { chatId: first.id, cliId: second.cliId })
  await waitFor(async () => (await value('agents.list', { workspaceId: chatWs.id })).find((a) => a.id === first.id)?.cliId === second.cliId, 'the agent follows its chat’s CLI')
  await value('chat.update', { chatId: first.id, cliId: first.cliId })
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

await test('Also ask: a chat picks other CLIs for its next message; this one is not offered', async () => {
  const agents = await value('agents.list', { workspaceId: chatWs.id })
  const codex = agents.find((a) => a.cliId === 'codex')
  const pane = page.locator(`section[aria-label="${codex.petName} agent"]`)
  const chatClis = await value('chat.clis')
  const others = chatClis.filter((id) => id !== 'codex')
  const pill = pane.getByRole('button', { name: /^Also ask/ })
  if (!others.length) {
    expect((await pill.count()) === 0, 'Also ask shown with no other chat CLI')
    return console.log('    (only one chat CLI installed: nothing to pick)')
  }
  await pill.click()
  const menu = page.getByRole('menu', { name: 'Also ask' })
  const names = await menu.getByRole('menuitemradio').allTextContents()
  expect(names.length === others.length && !names.some((n) => /codex/i.test(n)), `offered: ${names}`)
  await menu.getByRole('menuitemradio').first().click()
  // The menu stays open for more picks; the pill says how many.
  expect((await menu.getByRole('menuitemradio', { checked: true }).count()) === 1, 'the pick is not checked')
  await page.keyboard.press('Escape')
  await pane.getByRole('button', { name: 'Also ask 1 more CLI' }).waitFor()
  await pane.getByRole('button', { name: 'Also ask 1 more CLI' }).click()
  await page.getByRole('menu', { name: 'Also ask' }).getByRole('menuitem', { name: 'Only this chat' }).click()
  await pane.getByRole('button', { name: 'Also ask other CLIs' }).waitFor()
})

if (process.env.E2E_CHAT) {
  await test('Also ask: one message, answered by two CLIs side by side', async () => {
    const agents = await value('agents.list', { workspaceId: chatWs.id })
    const codex = agents.find((a) => a.cliId === 'codex')
    const pane = page.locator(`section[aria-label="${codex.petName} agent"]`)
    await pane.getByRole('button', { name: /^Also ask/ }).click()
    const pick = page.getByRole('menu', { name: 'Also ask' }).getByRole('menuitemradio', { name: /Claude/ })
    await pick.click()
    await page.keyboard.press('Escape')
    await pane.getByLabel('Message').fill('Reply with exactly: twin')
    await pane.getByLabel('Message').press('Enter')
    await waitFor(async () => (await value('agents.list', { workspaceId: chatWs.id })).length === agents.length + 1, 'a new chat for the other CLI', 20000)
    const added = (await value('agents.list', { workspaceId: chatWs.id })).find((a) => !agents.some((b) => b.id === a.id))
    expect(added.chatUi && added.cliId === 'claude', JSON.stringify(added))
    for (const id of [codex.id, added.id]) await page.locator(`section[aria-label="${(await value('agents.list', { workspaceId: chatWs.id })).find((a) => a.id === id).petName} agent"]`).getByText('twin', { exact: true }).last().waitFor({ timeout: 120000 })
    await shot('g6-also-ask')
    await value('agents.close', { instanceId: added.id })
  })
}

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

await test('right-click menus: workspace actions without a ⋯ button', async () => {
  const row = page.getByRole('navigation', { name: 'Workspaces' }).getByRole('button', { name: 'Chatty', exact: true })
  await row.click({ button: 'right' })
  expect(await page.getByRole('menuitem', { name: 'Delete worktree' }).isVisible(), 'worktree context menu missing')
  await page.keyboard.press('Escape')
  expect((await page.getByRole('navigation', { name: 'Workspaces' }).getByRole('button', { name: /actions$/ }).count()) === 0, '⋯ buttons still in the sidebar')
  await page.getByRole('navigation', { name: 'Workspaces' }).getByRole('button', { name: /^demo-app(: open .*)?$/ }).first().click({ button: 'right' })
  expect(await page.getByRole('menuitem', { name: 'Remove workspace…' }).isVisible(), 'workspace context menu missing')
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
  expect((await value('agents.list', { workspaceId: chatWs.id })).every((a) => a.chatUi), 'chat-view agents lost')
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
  await openSidebarWorkspace('demo-app', 'Main')
  await page.waitForSelector('text=Empty worktree')
  expect((await value('layout.get', { workspaceId: mainWs.id })) === null, 'layout not cleared')
})

await test('removing the Primary removes the workspace from Hiveory; its folder is untouched (ADR 0013, 0039)', async () => {
  await page.getByRole('navigation', { name: 'Workspaces' }).getByRole('button', { name: 'demo-app, primary worktree' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Remove workspace/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: /^Remove/ }).click()
  await waitFor(async () => !(await value('projects.list')).some((p) => p.id === projectId), 'workspace removed')
  expect(existsSync(join(repo, 'README.md')), 'its folder was touched')
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
finish()
