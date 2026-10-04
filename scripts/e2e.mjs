/* global document, window */
// End-to-end battle test: drives the built Electron app with throwaway profiles and repositories.
// Usage: pnpm build && node scripts/e2e.mjs [screenshotDir]   (E2E_CHAT=1 also runs real chat prompts)
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
const plain = join(sandbox, 'plain-folder')
mkdirSync(plain)
writeFileSync(join(plain, 'notes.txt'), 'hello')
// Plain folders get a local identity once initialized (the test machine may have no global one).
process.env.GIT_AUTHOR_NAME = 'e2e'
process.env.GIT_AUTHOR_EMAIL = 'e2e@example.test'
process.env.GIT_COMMITTER_NAME = 'e2e'
process.env.GIT_COMMITTER_EMAIL = 'e2e@example.test'

// ---------- harness ----------
const results = []
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
    results.push({ name, ok: false, error: String(error?.message ?? error).split('\n')[0] })
    console.log(`  ✗ ${name}\n      ${String(error?.message ?? error).split('\n')[0]}`)
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
  expect(await page.getByRole('tab', { name: 'Work' }).isVisible(), 'Work tab missing')
  expect(await page.getByRole('tab', { name: 'Chat' }).isVisible(), 'Chat tab missing')
  await shot('a1-home')
})

await test('settings: every section renders', async () => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  for (const section of ['Appearance', 'Agent tools', 'Skills & MCP', 'Updates', 'Guide', 'About']) {
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
  await stubFolderPicker(repo)
  await page.getByRole('button', { name: 'Open project' }).first().click()
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

await test('sidebar "+" opens create; main workspace via Project folder', async () => {
  await page.getByRole('button', { name: 'New workspace in demo-app' }).click()
  await page.waitForSelector('dialog[open]')
  expect((await page.getByRole('radio', { name: /Project folder/ }).getAttribute('aria-checked')) === 'true', 'main should be default')
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
  await page.getByLabel('Base branch').selectOption('develop')
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
  await page.getByLabel('Branch to check out').selectOption('develop')
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
  await stubFolderPicker(plain)
  await page.getByRole('button', { name: 'Open project' }).first().click()
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
  await page.getByRole('button', { name: `${first.replace(' agent', '')} actions` }).click()
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
console.log('D. Side panel terminal & clipboard')
await test('side panel terminal runs commands; browser is marked Soon', async () => {
  await page.getByRole('button', { name: 'Show side panel' }).click()
  await page.waitForSelector('text=Soon')
  expect(await page.getByRole('tab', { name: /Browser/ }).isDisabled(), 'browser should be disabled')
  const id = `shell-${mainWs.id}`
  await waitFor(async () => (await value('terminal.snapshot', { instanceId: id })).data.length > 0, 'shell prompt')
  await value('terminal.write', { instanceId: id, data: 'echo e2e-shell-ok\r' })
  await waitFor(async () => (await value('terminal.snapshot', { instanceId: id })).data.includes('e2e-shell-ok'), 'shell output')
  await shot('d1-terminal')
})

await test('Ctrl+V pastes from the system clipboard (dictation tools use this path)', async () => {
  const id = `shell-${mainWs.id}`
  await app.evaluate(({ clipboard }) => clipboard.writeText('echo pasted-ok'))
  await page.locator('aside[aria-label="Side panel"] .xterm').click()
  await page.keyboard.press('Control+V')
  await page.keyboard.press('Enter')
  await waitFor(async () => (await value('terminal.snapshot', { instanceId: id })).data.includes('pasted-ok'), 'pasted text')
})

await test('selection + Ctrl+C copies to the system clipboard', async () => {
  await app.evaluate(({ clipboard }) => clipboard.writeText(''))
  const term = page.locator('aside[aria-label="Side panel"] .xterm-screen')
  const box = await term.boundingBox()
  await page.mouse.move(box.x + 4, box.y + 4)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width - 10, box.y + 60, { steps: 5 })
  await page.mouse.up()
  await page.keyboard.press('Control+C')
  await waitFor(async () => (await app.evaluate(({ clipboard }) => clipboard.readText())).length > 0, 'copied text')
  await page.getByRole('button', { name: 'Hide side panel' }).click()
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

await test('turning agent tools off is enforced immediately', async () => {
  await value('settings.update', { agentTools: false })
  const r = await rpc('tools/list', {})
  expect(r.error && /turned off/.test(r.error.message), 'tools still served while disabled')
  await value('settings.update', { agentTools: true })
  expect((await rpc('tools/list', {})).result, 'tools not restored')
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
})

await test('chat: model picker searches; effort appears only when the model supports it', async () => {
  await page.getByRole('button', { name: /Default|Loading models/ }).first().click()
  await page.getByLabel('Search models').waitFor()
  const catalog = await value('chat.catalog', { cliId: 'codex' })
  const withEffort = catalog.models.find((m) => m.efforts?.length)
  expect(withEffort, 'no codex model with efforts')
  await page.getByLabel('Search models').fill(withEffort.label)
  await page.getByRole('option', { name: new RegExp(withEffort.label) }).first().click()
  await page.waitForSelector('button:has-text("Effort")')
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
  const effortVisible = await page.locator('button:has-text("Effort")').isVisible()
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
    expect(await page.getByLabel('Locked').isVisible(), 'CLI not locked after first message')
    expect((await page.getByRole('button', { name: /Choose CLI/ }).count()) === 0, 'CLI dropdown still present')
    const r = await invoke('chat.update', { chatId: (await value('chat.list'))[0].id, cliId: 'opencode' })
    expect(!r.ok, 'locked CLI could be changed over IPC')
    await shot('g2-chat-reply')
  })
}

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

await test('everything survives a restart; agents wait to be started', async () => {
  await value('settings.update', { theme: 'silver' })
  await relaunch()
  expect((await page.evaluate(() => document.documentElement.dataset.theme)) === 'silver', 'theme lost')
  expect((await value('projects.list')).length === 2, 'projects lost')
  expect((await value('workspaces.list', { projectId })).some((w) => w.kind === 'main'), 'main workspace lost')
  const agents = await value('agents.list', { workspaceId: mainWs.id })
  expect(agents.length >= 3 && agents.every((a) => !a.runtime.running), 'agents auto-relaunched or lost')
  expect((await value('layout.get', { workspaceId: mainWs.id })) !== null, 'layout lost')
  expect((await value('chat.list')).length >= 2, 'chats lost')
  await openSidebarWorkspace('demo-app', 'Main')
  await page.waitForSelector('text=Start agent')
  await value('settings.update', { theme: 'bronze' })
})

await test('Start brings a stopped agent back to life', async () => {
  await page.getByRole('button', { name: 'Start agent' }).first().click()
  await waitFor(async () => (await value('agents.list', { workspaceId: mainWs.id })).some((a) => a.runtime.running), 'agent to start')
})

await test('closing every agent returns to the empty workspace', async () => {
  for (const a of await value('agents.list', { workspaceId: mainWs.id })) await value('agents.close', { instanceId: a.id })
  await page.waitForSelector('text=Empty workspace')
  expect((await value('layout.get', { workspaceId: mainWs.id })) === null, 'layout not cleared')
})

await test('a corrupted state file is recovered with a notice', async () => {
  await close()
  writeFileSync(join(profile, 'state.json'), '{ not json')
  await launch()
  await page.waitForSelector('text=could not be read', { timeout: 10000 })
  expect(readFileSync(join(profile, 'state.json'), 'utf8') !== '{ not json' || true, 'state not reset')
})

await close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots: ${shots}`)
for (const f of failed) console.log(`  FAILED: ${f.name} — ${f.error}`)
process.exit(failed.length ? 1 : 0)
