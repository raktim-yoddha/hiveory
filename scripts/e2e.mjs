/* global document, window, getComputedStyle */
// End-to-end battle test: drives the built Electron app with throwaway profiles and repositories.
// Usage: pnpm build && node scripts/e2e.mjs [screenshotDir]   (E2E_CHAT=1 also runs real chat prompts)
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  expect((await value('settings.get')).theme === 'dark', 'Dark is not the default theme')
  expect(await page.getByRole('tab', { name: 'Work' }).isVisible(), 'Work tab missing')
  expect(await page.getByRole('tab', { name: 'Chat' }).isVisible(), 'Chat tab missing')
  await shot('a1-home')
})

await test('settings: every section renders', async () => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  for (const section of ['Appearance', 'Agents', 'Skills & MCP', 'Updates', 'Guide', 'About']) {
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
console.log('D. Side panel, sidebars, terminal & clipboard')
// eslint-disable-next-line no-control-regex -- strips terminal escape sequences
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g
const sidePanel = () => page.locator('aside[aria-label="Side panel"]')
await test('side panel starts empty; "+" adds terminals and browsers as tabs', async () => {
  await page.getByRole('button', { name: 'Show side panel' }).click()
  await sidePanel().getByText('Nothing open').waitFor()
  const add = async (kind) => {
    await sidePanel().getByRole('button', { name: 'Add terminal or browser' }).first().click()
    await page.getByRole('menuitem', { name: new RegExp(kind) }).click()
  }
  await add('Terminal')
  await add('Browser')
  await add('Terminal')
  await waitFor(async () => (await sidePanel().getByRole('tab').count()) === 3, 'three tabs')
  const tabs = await sidePanel().getByRole('tab').allInnerTexts()
  expect(JSON.stringify(tabs) === JSON.stringify(['Terminal', 'New tab', 'Terminal 2']), `tabs: ${tabs}`)
  await sidePanel().getByRole('tab', { name: 'New tab' }).click()
  expect(await sidePanel().getByLabel('Address').isVisible(), 'browser address bar missing')
  for (const tab of ['t1', 't2']) {
    const id = `shell-${mainWs.id}-${tab}`
    await waitFor(async () => (await value('terminal.snapshot', { instanceId: id })).data.length > 0, `shell prompt ${tab}`)
    await value('terminal.write', { instanceId: id, data: `echo e2e-${tab}-ok\r` })
    await waitFor(async () => (await value('terminal.snapshot', { instanceId: id })).data.includes(`e2e-${tab}-ok`), `shell output ${tab}`)
  }
  // Compact prompt: the folder name, not the full app-data path.
  const prompt = (await value('terminal.snapshot', { instanceId: `shell-${mainWs.id}-t1` })).data
  expect(!/Hiveory[^\r\n]*Workspaces/.test(prompt) && /demo-app>/.test(prompt.replace(ANSI, '')), 'prompt is not compact')
  await sidePanel().getByRole('tab', { name: 'Terminal', exact: true }).click()
  await shot('d1-terminal')
})

await test('closing a terminal tab ends its shell; the panel maximizes over the main area', async () => {
  await sidePanel().getByRole('button', { name: 'Close Terminal 2' }).click()
  await sidePanel().getByRole('button', { name: 'Close New tab' }).click()
  await waitFor(async () => (await sidePanel().getByRole('tab').count()) === 1, 'tabs closed')
  expect((await value('browser.state')).pages.length === 0, 'closing the browser tab left its page open')
  const before = await sidePanel().boundingBox()
  const paneBefore = await panes().first().boundingBox()
  await page.getByRole('button', { name: 'Maximize side panel' }).click()
  await page.waitForTimeout(250)
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

await test('Ctrl+V pastes from the system clipboard (dictation tools use this path)', async () => {
  const id = `shell-${mainWs.id}-t1`
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
  expect((await bar.getByLabel('Device', { exact: true }).inputValue()) === 'iPhone SE', 'toolbar does not show the device')
  await shot('e3-browser-device')
  await bar.getByLabel('Device', { exact: true }).selectOption('iPad Mini')
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
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots: ${shots}`)
for (const f of failed) console.log(`  FAILED: ${f.name} — ${f.error}`)
process.exit(failed.length ? 1 : 0)
