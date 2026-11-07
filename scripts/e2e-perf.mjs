/* global window, requestAnimationFrame */
// How fast the window answers: toggling the sidebars and switching worktrees with live terminals.
// Prints the time from a click to the frame that shows it, and the main thread's long tasks.
// Usage: pnpm build && node scripts/e2e-perf.mjs
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, close, expect, finish, launch, page, sandbox, test, value, waitFor } from './e2e-harness.mjs'

const repo = join(sandbox, 'demo-app')
mkdirSync(repo)
for (const args of [['init', '-b', 'main'], ['config', 'user.email', 'e2e@example.test'], ['config', 'user.name', 'e2e']]) execFileSync('git', args, { cwd: repo })
writeFileSync(join(repo, 'README.md'), '# demo\n')
execFileSync('git', ['add', '.'], { cwd: repo })
execFileSync('git', ['commit', '-m', 'init'], { cwd: repo })

await launch()

/** Clicks, then measures: ms to the next painted frame, ms until 300 ms pass with no long task, and long tasks seen. */
const measure = async (locator) => {
  await page.evaluate(() => {
    window.__long = []
    window.__obs?.disconnect()
    window.__obs = new PerformanceObserver((list) => window.__long.push(...list.getEntries().map((e) => ({ start: e.startTime, ms: e.duration }))))
    window.__obs.observe({ type: 'longtask', buffered: false })
  })
  const t0 = await page.evaluate(() => performance.now())
  await locator.click()
  const frame = await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(performance.now())))))
  await page.waitForTimeout(900)
  const long = await page.evaluate(() => window.__long)
  const after = long.filter((l) => l.start >= 0)
  return { frame: Math.round(frame - t0), longTasks: after.length, longest: Math.round(Math.max(0, ...after.map((l) => l.ms))), blocked: Math.round(after.reduce((a, l) => a + l.ms, 0)) }
}

const report = (name, runs) => {
  const pick = (k) => runs.map((r) => r[k]).sort((a, b) => a - b)[Math.floor(runs.length / 2)]
  const line = { frame: pick('frame'), longest: pick('longest'), blocked: pick('blocked') }
  console.log(`      ${name}: next frame ${line.frame} ms · longest task ${line.longest} ms · blocked ${line.blocked} ms (median of ${runs.length})`)
  return line
}

let results = {}
await test('setup: a worktree with four terminals', async () => {
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
  }, repo)
  await value('projects.pickFolder', { purpose: 'project' })
  const project = await value('projects.add', { mode: 'folder', path: repo })
  let primary
  await waitFor(async () => (primary = (await value('workspaces.list', { projectId: project.id })).find((w) => w.kind === 'main')), 'the primary worktree')
  const shell = (await value('clis.list')).find((c) => c.available && c.kind === 'shell') ?? (await value('clis.list')).find((c) => c.available)
  for (let i = 0; i < 4; i++) await value('agents.open', { workspaceId: primary.id, cliId: shell.id })
  const sidebar = page.getByRole('navigation', { name: 'Workspaces' })
  const row = sidebar.getByRole('button', { name: 'demo-app, primary worktree' })
  if (!(await row.isVisible())) await sidebar.getByRole('button', { name: /^demo-app: open/ }).click()
  if (await row.isVisible()) await row.click()
  await waitFor(async () => (await page.locator('.xterm').count()) >= 4, 'four terminals on screen')
  await page.waitForTimeout(1500)
})

await test('toggling the left sidebar', async () => {
  const runs = []
  for (let i = 0; i < 4; i++) {
    runs.push(await measure(page.getByRole('button', { name: 'Hide sidebar' }).first()))
    runs.push(await measure(page.getByRole('button', { name: 'Show sidebar' }).first()))
  }
  results.sidebar = report('left sidebar', runs)
})

await test('toggling the side panel', async () => {
  const runs = []
  for (let i = 0; i < 4; i++) {
    runs.push(await measure(page.getByRole('button', { name: 'Show side panel' }).first()))
    runs.push(await measure(page.getByRole('button', { name: 'Hide side panel' }).first()))
  }
  results.panel = report('side panel', runs)
})

await test('switching between two worktrees with terminals', async () => {
  const project = (await value('projects.list')).find((p) => p.name === 'demo-app')
  const other = await value('workspaces.create', { projectId: project.id, kind: 'isolated', name: 'other', cliSelections: [], autoApprove: false })
  const shell = (await value('clis.list')).find((c) => c.available && c.kind === 'shell') ?? (await value('clis.list')).find((c) => c.available)
  for (let i = 0; i < 2; i++) await value('agents.open', { workspaceId: other.id, cliId: shell.id })
  const sidebar = page.getByRole('navigation', { name: 'Workspaces' })
  const primaryRow = sidebar.getByRole('button', { name: 'demo-app, primary worktree' })
  const otherRow = sidebar.getByRole('button', { name: 'other' }).first()
  await otherRow.waitFor()
  const runs = []
  for (let i = 0; i < 4; i++) {
    runs.push(await measure(otherRow))
    runs.push(await measure(primaryRow))
  }
  results.switch = report('worktree switch', runs)
})

await test('opening Settings', async () => {
  const runs = []
  for (let i = 0; i < 3; i++) {
    runs.push(await measure(page.getByRole('button', { name: 'Settings' }).first()))
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
  }
  results.settings = report('Settings', runs)
})

await test('budgets: every action paints within a few frames and never blocks for long', async () => {
  for (const [name, r] of Object.entries(results)) {
    // Four frames at 60 Hz: the click's own frame, layout, paint, and one spare for a busy machine.
    expect(r.frame <= 67, `${name}: next frame after ${r.frame} ms`)
    expect(r.longest <= 100, `${name}: a ${r.longest} ms long task`)
  }
})

await close()
finish()
