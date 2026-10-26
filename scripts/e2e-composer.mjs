// End-to-end: the chat composer and the new shortcuts (ADR 0047 amendment, ADR 0055) — Tabs only, real
// model names, the usage limits popover, the worktree picker and a Schedules calendar in every mode.
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

await test('Chat: real model names, no tick, a worktree picker, and the usage limits popover', async () => {
  await page.keyboard.press(`${mod}+Digit3`)
  await page.keyboard.press(`${mod}+KeyN`)
  const cli = page.getByRole('button', { name: 'Choose CLI' })
  await cli.waitFor()
  await cli.click()
  await page.getByRole('menuitemradio', { name: 'Claude Code' }).click()
  const model = page.getByRole('button', { name: /Default|Opus|Loading/ }).first()
  await waitFor(async () => !/Loading/.test((await model.textContent()) ?? ''), 'models listed', 30_000)
  await model.click()
  const list = page.getByRole('listbox', { name: 'Models' })
  await list.waitFor()
  const names = await list.getByRole('option').allInnerTexts()
  console.log(`    models: ${names.map((n) => n.split('\n')[0]).join(' | ')}`)
  expect(names.some((n) => /\d/.test(n.split('\n')[0])), 'no model names a version')
  expect(!(await list.locator('svg.lucide-check').count()), 'the model list still has a tick')
  await shot('c1-models')
  await page.keyboard.press('Escape')

  await page.getByRole('main').getByRole('button', { name: 'Home folder', exact: true }).click()
  await page.getByRole('menuitemradio', { name: /fix-login/ }).click()
  await waitFor(async () => (await page.getByRole('button', { name: 'demo-app · fix-login' }).count()) > 0, 'the worktree chosen')
  const chats = await value('chat.list')
  expect(chats.some((c) => c.workspaceId === worktree.id), 'the chat did not keep the worktree')
  await shot('c2-worktree')

  await page.getByRole('button', { name: 'Usage limits' }).click()
  const popover = page.getByRole('dialog', { name: 'Usage limits' })
  await popover.waitFor()
  await waitFor(async () => !/Asking/.test(await popover.innerText()), 'limits read', 30_000)
  console.log(`    limits: ${(await popover.innerText()).replace(/\s+/g, ' ').slice(0, 200)}`)
  expect(!(await page.getByRole('main').getByRole('button', { name: 'Saved prompts' }).count()), 'the saved prompts button is still there')
  await shot('c3-limits')
  await page.keyboard.press('Escape')
})

await test('Schedules calendar in Chat (sidebar and shortcut)', async () => {
  await page.getByRole('navigation', { name: 'Chats' }).getByRole('button', { name: 'Schedules' }).click()
  await page.getByRole('tablist', { name: 'Schedules view' }).waitFor()
  expect(await page.getByRole('tab', { name: 'Week' }).count(), 'no calendar views')
  await shot('c4-chat-schedules')
})

await test('Work: Schedules tab is a calendar; Ctrl Shift T opens the tab picker; Alt ↓ moves worktree', async () => {
  await page.keyboard.press(`${mod}+Digit1`)
  await value('agents.open', { workspaceId: worktree.id, cliId: (await value('clis.list')).find((c) => c.kind === 'shell' && c.available).id })
  const sidebar = page.getByRole('navigation', { name: 'Workspaces' })
  const unfold = sidebar.getByRole('button', { name: 'Unfold demo-app' })
  if (await unfold.count()) await unfold.click()
  await sidebar.getByRole('button', { name: 'fix-login', exact: true }).click()
  await page.locator('section[aria-label$=" agent"]').first().waitFor()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+KeyS' : 'Control+Shift+KeyS')
  await page.locator('aside[aria-label="Side panel"]').getByRole('tablist', { name: 'Schedules view' }).waitFor()
  await shot('c5-work-schedules')
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
