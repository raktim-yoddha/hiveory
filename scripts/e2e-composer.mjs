// End-to-end: the composer's shortcuts and the Schedules page (ADR 0047 amendment, ADR 0055, 0062) — Tabs only, real
// model names and the Schedules calendar.
// Usage: pnpm build && node scripts/e2e-composer.mjs [screenshotDir]
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, close, expect, finish, launch, page, sandbox, shot, test, value, waitFor } from './e2e-harness.mjs'

const repo = join(sandbox, 'demo-app')
mkdirSync(repo)
for (const args of [['init', '-b', 'main'], ['config', 'user.email', 'e2e@example.test'], ['config', 'user.name', 'e2e']]) execFileSync('git', args, { cwd: repo })
writeFileSync(join(repo, 'README.md'), '# demo\n')
execFileSync('git', ['add', '.'], { cwd: repo })
execFileSync('git', ['commit', '-m', 'init'], { cwd: repo })

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
let project
let worktree

console.log('Hiveory E2E: composer & shortcuts')
await launch()

await test('no welcome and no Panes settings: Tabs and Spaced are the only layout', async () => {
  expect(!(await page.getByRole('dialog').filter({ hasText: 'How should your agents' }).count()), 'the pane welcome still shows')
  await page.keyboard.press(`${mod}+Comma`)
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Appearance' }).click()
  const sections = page.getByRole('tablist', { name: 'Appearance sections' })
  await sections.waitFor()
  expect(!(await sections.getByRole('tab', { name: 'Panes' }).count()), 'Appearance still has Panes')
  await page.keyboard.press(`${mod}+Comma`)
})

await test('setup: a Workspace with a second worktree', async () => {
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
  }, repo)
  await value('projects.pickFolder', { purpose: 'project' })
  project = await value('projects.add', { mode: 'folder', path: repo })
  await waitFor(async () => (await value('workspaces.list', { projectId: project.id })).some((w) => w.kind === 'main'), 'the primary worktree')
  worktree = await value('workspaces.create', { projectId: project.id, kind: 'isolated', name: 'fix-login', cliSelections: [], autoApprove: false })
})

await test('Work: Schedules page is a calendar; Ctrl Shift T opens the tab picker; Alt ↓ moves worktree', async () => {
  await value('agents.open', { workspaceId: worktree.id, cliId: (await value('clis.list')).find((c) => c.kind === 'shell' && c.available).id })
  const sidebar = page.getByRole('navigation', { name: 'Workspaces' })
  const unfold = sidebar.getByRole('button', { name: 'Unfold demo-app' })
  if (await unfold.count()) await unfold.click()
  await sidebar.getByRole('button', { name: 'fix-login', exact: true }).click()
  await page.locator('section[aria-label$=" agent"]').first().waitFor()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+KeyS' : 'Control+Shift+KeyS')
  // The shortcut opens the Schedules page in the main area (ADR 0062); the worktree opens again from the sidebar.
  await page.locator('main').getByRole('tablist', { name: 'Schedules view' }).waitFor()
  await shot('c5-work-schedules')
  await sidebar.getByRole('button', { name: 'fix-login', exact: true }).click()
  await page.locator('section[aria-label$=" agent"]').first().waitFor()
  await page.locator('section[aria-label$=" agent"] .xterm').first().click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+KeyT' : 'Control+Shift+KeyT')
  await page.getByRole('dialog', { name: 'Add pane' }).waitFor()
  await shot('c6-new-tab')
  await page.keyboard.press('Escape')
  // Alt ↑ / ↓ (⌘⌥ on a Mac) steps through the Workspace's worktrees.
  await page.locator('section[aria-label$=" agent"] .xterm').first().click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Alt+ArrowUp' : 'Alt+ArrowUp')
  await waitFor(async () => !(await page.locator('section[aria-label="fix-login worktree"]').isVisible()), 'moved to another worktree')
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Alt+ArrowDown' : 'Alt+ArrowDown')
  await page.locator('section[aria-label="fix-login worktree"]').waitFor()
})

await close()
finish()
