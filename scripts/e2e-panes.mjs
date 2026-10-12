/* global document, getComputedStyle */
// End-to-end: browser pages follow every pane rule (ADR 0042, 0043), and round 13's pane promises (ADR 0044):
// terminals without status, Kanban states in words, terminals that remember, lazily loaded screens.
// Self-contained: sets up its own Workspace and agent over IPC, so it runs on its own and quickly.
// Usage: pnpm build && node scripts/e2e-panes.mjs [screenshotDir]
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { agentMcp, app, browserPane, close, expect, finish, launch, nativeShown, page, relaunch, sandbox, shot, test, value, waitFor } from './e2e-harness.mjs'

const repo = join(sandbox, 'demo-app')
mkdirSync(repo)
for (const args of [['init', '-b', 'main'], ['config', 'user.email', 'e2e@example.test'], ['config', 'user.name', 'e2e']]) execFileSync('git', args, { cwd: repo })
writeFileSync(join(repo, 'README.md'), '# demo\n')
execFileSync('git', ['add', '.'], { cwd: repo })
execFileSync('git', ['commit', '-m', 'init'], { cwd: repo })

const fixture = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' })
  res.end(req.url === '/two' ? '<!doctype html><title>Two</title><p>Second page</p>' : '<!doctype html><title>Fixture</title><h1>Browser fixture</h1><p>Some text</p>')
})
await new Promise((r) => fixture.listen(0, '127.0.0.1', r))
const port = String(fixture.address().port)
const host = `localhost:${port}`
const shown = () => nativeShown(port)

let project
let worktree
let agent
let tool

const sidebar = () => page.getByRole('navigation', { name: 'Workspaces' })
const agentPane = () => page.locator(`section[aria-label="${agent.petName} agent"]`)
const openWorktree = async () => {
  const primary = sidebar().getByRole('button', { name: 'demo-app, primary worktree' })
  if (!(await primary.isVisible())) await sidebar().getByRole('button', { name: /^demo-app: open/ }).click()
  if (await primary.isVisible()) await primary.click()
  await agentPane().waitFor()
}
/** Where main draws the page's native view, and the pane's box it should sit in. */
const viewInPane = async () => {
  const bounds = await app.evaluate(({ BrowserWindow }, part) => BrowserWindow.getAllWindows()[0].contentView.children.find((v) => v.webContents?.getURL().includes(part))?.getBounds(), port)
  const box = await browserPane().boundingBox()
  return { bounds, box, inside: bounds.x >= box.x - 1 && bounds.y >= box.y - 1 && bounds.x + bounds.width <= box.x + box.width + 1 && bounds.y + bounds.height <= box.y + box.height + 1 }
}

console.log(`Hiveory E2E: panes — sandbox ${sandbox}`)
await launch()

await test('setup: a Workspace with an agent in its primary worktree', async () => {
  await value('settings.update', { welcomed: true, paneStyle: 'tiles', paneSpacing: 'spaced' })
  // Hiveory adds only folders the user picked: stub the picker, then pick.
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
  }, repo)
  await value('projects.pickFolder', { purpose: 'project' })
  project = await value('projects.add', { mode: 'folder', path: repo })
  const cli = (await value('clis.list')).find((c) => c.available && c.id === 'claude') ?? (await value('clis.list')).find((c) => c.available)
  expect(cli, 'no CLI installed to run an agent')
  // Adding a folder makes its primary worktree; open one agent there.
  await waitFor(async () => (worktree = (await value('workspaces.list', { projectId: project.id })).find((w) => w.kind === 'main')), 'the primary worktree')
  agent = (await value('agents.open', { workspaceId: worktree.id, cliId: cli.id })).agent
  ;({ tool } = await agentMcp(agent.id))
  await openWorktree()
})

await test("an agent's page opens as a pane beside its agent, never in the side panel", async () => {
  const nav = await tool('browser_navigate', { url: host })
  expect(!nav.isError, JSON.stringify(nav).slice(0, 300))
  const pane = page.locator('section[aria-label$=" browser"]').filter({ hasText: `${agent.petName} · Fixture` })
  await pane.waitFor()
  const own = await agentPane().boundingBox()
  const box = await pane.boundingBox()
  const gap = box.x - (own.x + own.width)
  expect(Math.abs(box.y - own.y) < 2 && gap >= -1 && gap < 24, `page pane is not beside its agent (gap ${gap}, dy ${box.y - own.y})`)
  expect(!(await page.locator('aside[aria-label="Side panel"]').getByLabel('Address').count()), 'a browser in the side panel')
  await waitFor(shown, 'the page drawn over its pane')
  await waitFor(async () => (await viewInPane()).inside, 'the page inside its pane')
  await shot('p1-page-beside-agent')
})

await test('a click in the page selects its pane, like any pane', async () => {
  const view = app.windows().find((w) => w.url().includes(port))
  expect(view, 'browser page target not found')
  await view.click('h1')
  await waitFor(async () => (await browserPane().getAttribute('data-focused')) === 'true', 'the browser pane marked selected')
  const selected = await browserPane().evaluate((el) => getComputedStyle(el).borderColor)
  const resting = await agentPane().evaluate((el) => getComputedStyle(el).borderColor)
  expect(selected !== resting, 'the selected page pane looks like a resting one')
  await shot('p2-page-selected')
  await agentPane().locator('header').click({ position: { x: 60, y: 10 } })
  await waitFor(async () => (await browserPane().getAttribute('data-focused')) === null, 'the mark moves off the page pane')
})

await test('the page steps aside for a menu and under a maximized side panel', async () => {
  await browserPane().getByRole('button', { name: 'More browser actions' }).click()
  await page.getByRole('menuitem', { name: 'Pick element' }).waitFor()
  await waitFor(async () => !(await shown()), 'the page to step aside for a menu', 3000)
  await page.keyboard.press('Escape')
  await waitFor(shown, 'the page back after the menu', 3000)
  if (await page.getByRole('button', { name: 'Show side panel' }).count()) await page.getByRole('button', { name: 'Show side panel' }).click()
  await page.getByRole('button', { name: 'Maximize side panel' }).click()
  await waitFor(async () => !(await shown()), 'the page hidden under the maximized side panel', 3000)
  await shot('p3-under-maximized-panel')
  await page.getByRole('button', { name: 'Restore side panel' }).click()
  await waitFor(shown, 'the page back once the panel is restored', 3000)
})

await test('attached spacing: panes meet edge to edge and the page follows its pane', async () => {
  await value('settings.update', { paneSpacing: 'attached' })
  await waitFor(async () => (await page.evaluate(() => document.documentElement.dataset.panes)) === 'attached', 'attached applied')
  await waitFor(async () => {
    const own = await agentPane().boundingBox()
    const box = await browserPane().boundingBox()
    return Math.abs(box.x - (own.x + own.width)) <= 1
  }, 'the panes to touch')
  await waitFor(async () => (await viewInPane()).inside, 'the page re-placed inside its pane')
  const radius = await browserPane().evaluate((el) => getComputedStyle(el).borderTopLeftRadius)
  expect(radius === '0px', `attached panes keep rounded corners (${radius})`)
  await shot('p4-attached')
  await value('settings.update', { paneSpacing: 'spaced' })
  await waitFor(async () => (await viewInPane()).inside, 'the page re-placed after going back to spaced')
})

await test('Tabs style: the page hides behind another tab; jumping to it from the sidebar shows it', async () => {
  const pageId = (await value('browser.state')).pages.find((p) => p.scope === worktree.id).id
  await value('settings.update', { paneStyle: 'tabs' })
  await value('layout.apply', { workspaceId: worktree.id, operation: { type: 'stack', paneId: pageId, targetPaneId: agent.id } })
  await value('layout.apply', { workspaceId: worktree.id, operation: { type: 'activate', paneId: agent.id } })
  await waitFor(async () => !(await shown()), 'the page hidden behind its tab', 3000)
  await page.getByRole('tab', { name: /Fixture/ }).first().click()
  await waitFor(shown, 'the page shown when its tab is chosen', 3000)
  await page.getByRole('tab', { name: new RegExp(agent.petName) }).first().click()
  await waitFor(async () => !(await shown()), 'the page hidden again', 3000)
  // The worktree's pane list in the sidebar (ADR 0043) jumps to the page and brings its tab forward.
  const bar = sidebar().getByRole('button', { name: /^Show all 2 panes/ })
  if (await bar.count()) await bar.click()
  await sidebar().getByRole('button', { name: /Fixture · Browser/ }).click()
  await waitFor(shown, 'the page brought forward from the sidebar', 3000)
  await shot('p5-tabs')
  await value('settings.update', { paneStyle: 'tiles' })
})

await test('an agent browses a page nobody has seen: a worktree that is not open', async () => {
  const other = await value('workspaces.create', { projectId: project.id, kind: 'isolated', name: 'Unseen', cliSelections: [], autoApprove: false })
  const cli = (await value('clis.list')).find((c) => c.id === agent.cliId)
  const away = (await value('agents.open', { workspaceId: other.id, cliId: cli.id })).agent
  const { tool: awayTool } = await agentMcp(away.id)
  const snap = await awayTool('browser_navigate', { url: host })
  const text = snap.content.map((c) => c.text ?? '').join('\n')
  expect(/heading "Browser fixture"/.test(text) && !/viewport 0×0/.test(text), `an unseen page has no size:\n${text.slice(0, 400)}`)
  await value('workspaces.delete', { workspaceId: other.id, force: true })
})

await test("a popup opens right after its opener; a removed worktree closes its pages", async () => {
  const before = (await value('browser.state')).pages.filter((p) => p.scope === worktree.id).map((p) => p.id)
  await tool('browser_evaluate', { script: `window.open('http://${host}/two'); 'ok'` })
  await waitFor(async () => (await value('browser.state')).pages.filter((p) => p.scope === worktree.id).length === before.length + 1, 'popup opened')
  const popup = (await value('browser.state')).pages.find((p) => p.scope === worktree.id && !before.includes(p.id))
  const layout = JSON.stringify(await value('layout.get', { workspaceId: worktree.id }))
  const order = [...layout.matchAll(/"paneId":"([^"]+)"/g)].map((m) => m[1])
  expect(order[order.indexOf(before[0]) + 1] === popup.id, `popup not right after its opener: ${layout}`)
  await value('browser.close', { pageId: popup.id })

  const other = await value('workspaces.create', { projectId: project.id, kind: 'isolated', name: 'Pages', cliSelections: [], autoApprove: false })
  const opened = await value('browser.open', { scope: other.id, url: `http://${host}/two` })
  await value('workspaces.delete', { workspaceId: other.id, force: true })
  await waitFor(async () => !(await value('browser.state')).pages.some((p) => p.id === opened.id), 'the removed worktree left its page running')
})

await test('terminals carry no status: no dot on the pane or in the sidebar; Kanban cards say their state (ADR 0044)', async () => {
  const shellCli = (await value('clis.list')).find((c) => c.available && c.kind === 'shell')
  expect(shellCli, 'no terminal installed')
  const shell = (await value('agents.open', { workspaceId: worktree.id, cliId: shellCli.id })).agent
  const pane = page.locator(`section[aria-label="${shell.petName} agent"]`)
  await pane.waitFor()
  // Its header has the CLI's logo only; an agent's has the logo and its status dot.
  expect((await pane.locator('header [role="img"]').count()) === 1, 'a terminal pane shows a status dot')
  expect((await agentPane().locator('header [role="img"]').count()) === 2, "the agent's pane lost its status dot")
  // The worktree's pane list (folded bar or unfolded rows) calls it a terminal, with no state.
  const bar = sidebar().getByRole('button', { name: /^Show all/ })
  if (await bar.count()) await bar.click()
  await sidebar().getByRole('button', { name: `${shell.petName} · Terminal` }).waitFor()
  // The Dashboard's board: the agent's card names its state; the terminal has no card.
  if (await page.getByRole('button', { name: 'Show side panel' }).count()) await page.getByRole('button', { name: 'Show side panel' }).click()
  await page.locator('aside[aria-label="Side panel"]').getByRole('tab', { name: 'Dashboard' }).click()
  const card = page.locator(`aside[aria-label="Side panel"] button[aria-label^="${agent.petName},"]`)
  await card.waitFor()
  expect(/Idle|Working|Waiting for you|Stopped/.test(await card.innerText()), `the card does not say its state: ${await card.innerText()}`)
  expect((await page.locator(`aside[aria-label="Side panel"] button[aria-label^="${shell.petName},"]`).count()) === 0, 'a terminal has a Kanban card')
  await shot('p6-terminal-and-card')
  await page.getByRole('button', { name: 'Hide side panel' }).click()
  await value('terminal.write', { instanceId: shell.id, data: 'echo hv-memory-ok\r' })
  await waitFor(async () => (await value('terminal.snapshot', { instanceId: shell.id })).data.includes('hv-memory-ok'), 'terminal output')
  globalThis.__shell = shell
})

await test('a terminal shows what it printed after Hiveory restarts (ADR 0044)', async () => {
  const shell = globalThis.__shell
  await relaunch()
  await openWorktree()
  await page.locator(`section[aria-label="${shell.petName} agent"]`).waitFor()
  await waitFor(async () => {
    const out = (await value('terminal.snapshot', { instanceId: shell.id })).data
    return out.includes('hv-memory-ok') && out.includes('restored from last time')
  }, 'the old output restored above the new prompt', 20000)
  await shot('p7-terminal-restored')
})

await test('Settings, Bots and Chat load on first open without errors (ADR 0044)', async () => {
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('heading', { name: 'Appearance' }).waitFor()
  await page.locator('dialog[open]').getByRole('button', { name: 'Close settings' }).click()
  await page.getByRole('tab', { name: 'Bots' }).click()
  await page.getByText(/Build your team of bots|Bots/).first().waitFor()
  await page.getByRole('tab', { name: 'Chat' }).click()
  await page.waitForTimeout(800)
  await page.getByRole('tab', { name: 'Work' }).click()
  await openWorktree()
  expect(errors.length === 0, `errors: ${errors.join(' | ')}`)
})

await close()
fixture.close()
finish()
