// End-to-end: the side panel's Changes tab and the chat-view message box (ADR 0058). No model is called:
// the chat agent is opened but never sent a message.
// Usage: pnpm build && node scripts/e2e-changes.mjs [screenshotDir]
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, close, expect, finish, launch, page, sandbox, shot, test, value, waitFor } from './e2e-harness.mjs'

const repo = join(sandbox, 'demo-app')
mkdirSync(join(repo, 'src'), { recursive: true })
const git = (...args) => execFileSync('git', args, { cwd: repo })
git('init', '-b', 'main')
git('config', 'user.email', 'e2e@example.test')
git('config', 'user.name', 'e2e')
writeFileSync(join(repo, 'README.md'), '# demo\n')
writeFileSync(join(repo, 'src', 'old.ts'), 'export const old = 1\n')
git('add', '.')
git('commit', '-m', 'init')
// Uncommitted work: an edit, a new file in a folder, a deletion.
writeFileSync(join(repo, 'README.md'), '# demo\n\nNow with docs.\nAnd more.\n')
mkdirSync(join(repo, 'src', 'app'), { recursive: true })
writeFileSync(join(repo, 'src', 'app', 'main.ts'), 'export const main = () => 42\n')
rmSync(join(repo, 'src', 'old.ts'))

let project
let primary
const panel = () => page.locator('aside[aria-label="Side panel"]')

console.log('Hiveory E2E: Changes tab & message box')
await launch()

await test('setup: a Workspace on a Git repository with uncommitted changes', async () => {
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
  }, repo)
  await value('projects.pickFolder', { purpose: 'project' })
  project = await value('projects.add', { mode: 'folder', path: repo })
  await waitFor(async () => (await value('workspaces.list', { projectId: project.id })).some((w) => w.kind === 'main'), 'the primary worktree')
  primary = (await value('workspaces.list', { projectId: project.id })).find((w) => w.kind === 'main')
})

await test('changes.list reads uncommitted, untracked and deleted files', async () => {
  const set = await value('changes.list', { workspaceId: primary.id, source: { kind: 'uncommitted' } })
  const files = set.files.map((f) => `${f.status}:${f.path}:+${f.additions}-${f.deletions}`)
  expect(set.branch === 'main', `branch is ${set.branch}`)
  expect(
    JSON.stringify(files) === JSON.stringify(['modified:README.md:+3-0', 'added:src/app/main.ts:+1-0', 'deleted:src/old.ts:+0-1']),
    `files: ${files.join(', ')}`
  )
})

await test('the Changes tab shows the tree and a diff in place', async () => {
  const sidebar = page.getByRole('navigation', { name: 'Workspaces' })
  await sidebar.getByText('demo-app', { exact: true }).first().click()
  await page.locator('section[aria-label$="worktree"]').first().waitFor()
  if (!(await panel().getByRole('tablist').count())) await page.getByRole('button', { name: /side panel$/i }).first().click()
  await panel().getByRole('tab', { name: 'Changes' }).click()
  const tree = panel().getByRole('tree', { name: 'Changed files' })
  await tree.waitFor()
  await tree.getByText('README.md').waitFor()
  await tree.getByText('main.ts').waitFor()
  await shot('ch1-changes-tree')
  await tree.getByRole('button', { name: /^README\.md/ }).click()
  await panel().getByRole('region', { name: 'Changes in README.md' }).getByText('Now with docs.').waitFor()
  await shot('ch2-changes-diff')
})

await test('the Branch source and an empty commit list do not break', async () => {
  await panel().getByRole('button', { name: 'Uncommitted' }).click()
  await page.getByRole('menuitemradio', { name: /Branch/ }).or(page.getByRole('menuitem', { name: /Branch/ })).first().click()
  await panel().getByRole('button', { name: 'Branch', exact: true }).waitFor()
  await shot('ch3-branch-source')
  await panel().getByRole('button', { name: 'Branch', exact: true }).click()
  await page.getByRole('menuitemradio', { name: /Uncommitted/ }).or(page.getByRole('menuitem', { name: /Uncommitted/ })).first().click()
})

await test('a chat-view agent: CLI and model picker, tracks with the worktree changes, @ files', async () => {
  const clis = await value('clis.list')
  const chatCli = ['claude', 'codex', 'opencode', 'gemini'].find((id) => clis.some((c) => c.id === id && c.available))
  if (!chatCli) return console.log('    (no chat CLI installed: skipped)')
  // The empty worktree's "+" isn't a pane yet: a shell gives the area a "+" to open the Chat UI from (ADR 0059).
  await value('agents.open', { workspaceId: primary.id, cliId: clis.find((c) => c.kind === 'shell' && c.available).id })
  await page.getByRole('button', { name: 'Add agent' }).first().click()
  const menu = page.getByRole('menu', { name: 'Open' })
  expect(!(await page.getByRole('combobox', { name: 'Open agents as' }).count()), 'the terminal/chat dropdown is still there')
  await shot('ch3b-plus-menu')
  await menu.getByRole('menuitem', { name: 'Chat UI' }).click()
  const box = page.getByRole('textbox', { name: 'Message', exact: true })
  await box.waitFor()
  expect((await box.getAttribute('placeholder'))?.includes('@files'), 'placeholder mentions @files')
  // The worktree's changes ride above the box.
  await page.getByRole('button', { name: /lines added/ }).or(page.getByTitle("Open the worktree's changes")).first().waitFor({ timeout: 20_000 })
  await page.locator('button[aria-haspopup]').filter({ hasText: /Default|Opus|Sonnet|GPT|model/ }).first().waitFor()
  await page.getByRole('button', { name: 'Add files or a picture' }).waitFor()
  await box.click()
  await box.fill('look at @mai')
  await page.getByRole('listbox', { name: 'Files' }).getByRole('option', { name: /main.ts/ }).waitFor()
  await shot('ch4-mention')
  await page.keyboard.press('Enter')
  await waitFor(async () => (await box.inputValue()) === 'look at @src/app/main.ts ', `mention inserted: ${await box.inputValue()}`)
  await page.locator('button[aria-haspopup]').filter({ hasText: /Default|Opus|Sonnet|GPT|model/ }).first().click()
  await page.getByRole('listbox', { name: /models/ }).getByRole('option').first().waitFor({ timeout: 40_000 })
  // CLIs down the left, beside the models.
  const tabs = await page.getByRole('tablist', { name: 'CLIs' }).getByRole('tab').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().left))
  expect(tabs.length < 2 || tabs.every((x) => x === tabs[0]), `CLI tabs are not in one column: ${tabs.join(', ')}`)
  await page.waitForTimeout(400)
  await shot('ch5-model-picker')
  await page.keyboard.press('Escape')
  await box.fill('/')
  await page.waitForTimeout(500)
  await shot('ch6-slash')
  await box.fill('')
})

await close()
finish()
