// End-to-end: commit, push and discard in the Changes tab, Settings › Usage, Find and pinned Workspaces
// (ADR 0060). No model is called. Hiveory runs with a throwaway home folder holding a made-up Claude
// Code history, so Usage shows known numbers and never the real computer's.
// Usage: pnpm build && node scripts/e2e-tools.mjs [screenshotDir]
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, close, expect, finish, invoke, launch, page, sandbox, shot, test, value, waitFor } from './e2e-harness.mjs'

const home = join(sandbox, 'home')
const repo = join(sandbox, 'demo-app')
const origin = join(sandbox, 'origin.git')
const outside = join(sandbox, 'outside.txt')
mkdirSync(join(repo, 'src'), { recursive: true })
const sh = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString()
const git = (...args) => sh(repo, ...args)
git('init', '-q', '-b', 'main')
git('config', 'user.email', 'e2e@example.test')
git('config', 'user.name', 'e2e')
git('config', 'core.autocrlf', 'false')
writeFileSync(join(repo, 'README.md'), '# demo\n')
writeFileSync(join(repo, 'src', 'keep.ts'), 'export const keep = 1\n')
git('add', '.')
git('commit', '-q', '-m', 'init')
execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin])
git('remote', 'add', 'origin', origin)
writeFileSync(outside, 'never touched\n')
// Work to commit, and a file to throw away.
writeFileSync(join(repo, 'README.md'), '# demo\n\nCommitted from the Changes tab.\n')
writeFileSync(join(repo, 'src', 'scratch.ts'), 'export const scratch = true\n')

// A made-up Claude Code history: two replies today (one written twice, as Claude does) and one yesterday.
const day = (offset) => {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() - offset)
  return d.toISOString()
}
const reply = (id, at, input, output) => JSON.stringify({ type: 'assistant', timestamp: at, message: { id, model: 'claude-e2e', usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 } } })
const history = join(home, '.claude', 'projects', 'demo-app')
mkdirSync(history, { recursive: true })
writeFileSync(join(history, 'session-e2e.jsonl'), [reply('a', day(0), 100, 50), reply('a', day(0), 100, 50), reply('b', day(0), 10, 5), reply('c', day(1), 1, 1)].join('\n') + '\n')

let project
let primary
const panel = () => page.locator('aside[aria-label="Side panel"]')
const tree = () => panel().getByRole('tree', { name: 'Changed files' })
const rejects = async (channel, payload, pattern, what) => {
  const r = await invoke(channel, payload)
  expect(!r.ok, `${what}: it was accepted`)
  expect(pattern.test(r.error.message), `${what}: ${r.error.message}`)
}

console.log('Hiveory E2E: commit, push, Usage, Find and pins')
await launch({ USERPROFILE: home, HOME: home })

await test('setup: a Workspace with uncommitted work', async () => {
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
  }, repo)
  await value('projects.pickFolder', { purpose: 'project' })
  project = await value('projects.add', { mode: 'folder', path: repo })
  await waitFor(async () => (await value('workspaces.list', { projectId: project.id })).some((w) => w.kind === 'main'), 'the primary worktree')
  primary = (await value('workspaces.list', { projectId: project.id })).find((w) => w.kind === 'main')
  await page.getByRole('navigation', { name: 'Workspaces' }).getByText('demo-app', { exact: true }).first().click()
  await page.locator('section[aria-label$="worktree"]').first().waitFor()
  if (!(await panel().getByRole('tablist').count())) await page.getByRole('button', { name: /side panel$/i }).first().click()
  await panel().getByRole('tab', { name: 'Changes' }).click()
  await tree().getByText('scratch.ts').waitFor()
})

await test('edge: bad commit, discard and usage requests are refused', async () => {
  await rejects('changes.commit', { workspaceId: primary.id, message: '   \n ' }, /commit message/i, 'a blank message')
  await rejects('changes.discard', { workspaceId: primary.id, paths: [] }, /./, 'no paths')
  // A path outside the worktree never reaches anything there.
  const r = await invoke('changes.discard', { workspaceId: primary.id, paths: ['../outside.txt'] })
  expect(!r.ok, 'discarding a path outside the repository was accepted')
  expect(readFileSync(outside, 'utf8') === 'never touched\n', 'a file outside the repository changed')
  await rejects('usage.report', { days: 0 }, /./, '0 days')
  await rejects('usage.report', { days: 365 }, /./, '365 days')
  await rejects('changes.push', { workspaceId: 'nope' }, /./, 'an unknown worktree')
})

await test('discard one file from the Changes tab, after a confirmation', async () => {
  await panel().getByRole('button', { name: 'Discard changes to scratch.ts' }).click({ force: true })
  const dialog = page.getByRole('dialog', { name: 'Discard changes to scratch.ts?' })
  await dialog.waitFor()
  await shot('t1-discard-confirm')
  await dialog.getByRole('button', { name: 'Discard' }).click()
  await waitFor(async () => !existsSync(join(repo, 'src', 'scratch.ts')), 'scratch.ts removed')
  await dialog.waitFor({ state: 'hidden' })
  await tree().getByRole('button', { name: /^scratch\.ts/ }).waitFor({ state: 'detached' })
  expect(existsSync(join(repo, 'src', 'keep.ts')), 'another file was removed')
})

await test('commit with Ctrl+Enter, then publish the branch', async () => {
  const message = panel().getByRole('textbox', { name: 'Commit message' })
  const commit = panel().getByRole('button', { name: 'Commit', exact: true })
  expect(await commit.isDisabled(), 'Commit is enabled without a message')
  await message.fill('docs: say where commits come from')
  await shot('t2-commit-bar')
  await message.press('Control+Enter')
  await waitFor(async () => git('log', '-1', '--format=%s').trim() === 'docs: say where commits come from', 'the commit')
  expect(git('status', '--porcelain') === '', `still uncommitted: ${git('status', '--porcelain')}`)
  await panel().getByText('No changes', { exact: true }).waitFor()
  const publish = panel().getByRole('button', { name: 'Publish branch' })
  await publish.waitFor()
  await publish.click()
  const onOrigin = () => {
    try {
      return sh(origin, 'log', '-1', '--format=%s', 'main').trim()
    } catch {
      return '' // not pushed yet
    }
  }
  await waitFor(() => onOrigin() === 'docs: say where commits come from', 'origin has the commit')
  await page.getByText('Pushed main to origin/main.').waitFor()
  await shot('t3-pushed')
  expect(git('rev-parse', '--abbrev-ref', 'main@{upstream}').trim() === 'origin/main', 'main does not track origin/main')
})

await test('a commit Git refuses shows Git’s reason', async () => {
  writeFileSync(join(repo, 'note.txt'), 'x\n')
  // A hook that refuses every commit.
  writeFileSync(join(repo, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho "no commits today" >&2\nexit 1\n')
  await rejects('changes.commit', { workspaceId: primary.id, message: 'blocked' }, /no commits today|hook/i, 'a refused commit')
  writeFileSync(join(repo, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 0\n')
  git('reset', '-q')
})

await test('Find: open it, search, run, and nothing for nonsense', async () => {
  await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => undefined)
  await page.keyboard.press('Control+Shift+KeyP')
  const dialog = page.getByRole('dialog', { name: 'Command palette' })
  await dialog.waitFor()
  const search = dialog.getByRole('combobox', { name: 'Search commands' })
  await search.fill('zzqqxx')
  await dialog.getByText(/Nothing matches/).waitFor()
  await search.fill('usage')
  await dialog.getByRole('option').first().waitFor()
  await shot('t4-find')
  await search.press('Enter')
  await page.getByRole('heading', { name: 'Usage' }).waitFor()
})

await test('Settings › Usage shows the history’s counts, each reply once', async () => {
  const page2 = page.getByRole('region', { name: 'Usage' }).or(page.locator('section[aria-label="Usage"]')).first()
  await page2.getByText('Total tokens').waitFor({ timeout: 20_000 })
  await page2.getByRole('button', { name: 'Today' }).or(page2.getByRole('tab', { name: 'Today' })).first().click()
  // Today: replies a (once) and b: 110 in, 55 out, 2000 from cache.
  await waitFor(async () => (await page2.getByRole('table').first().innerText()).includes('110'), 'today’s input of 110')
  const report = await value('usage.report', { days: 1 })
  const sum = report.rows.reduce((n, r) => ({ input: n.input + r.input, output: n.output + r.output, replies: n.replies + r.replies }), { input: 0, output: 0, replies: 0 })
  expect(sum.input === 110 && sum.output === 55 && sum.replies === 2, `today: ${JSON.stringify(sum)}`)
  await page2.getByRole('tab', { name: '7 days' }).or(page2.getByRole('button', { name: '7 days' })).first().click()
  await page2.getByRole('list', { name: 'Tokens per day' }).waitFor()
  await shot('t5-usage')
  await page.keyboard.press('Escape')
})

await test('pin a Workspace from its menu, and unpin it', async () => {
  const sidebar = page.getByRole('navigation', { name: 'Workspaces' })
  await sidebar.getByText('demo-app', { exact: true }).first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Pin to top' }).click()
  await waitFor(async () => (await value('projects.list')).find((p) => p.id === project.id)?.settings?.pinned === true, 'pinned')
  await sidebar.getByText('demo-app', { exact: true }).first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Unpin' }).waitFor()
  await shot('t6-pinned-menu')
  await page.getByRole('menuitem', { name: 'Unpin' }).click()
  await waitFor(async () => !(await value('projects.list')).find((p) => p.id === project.id)?.settings?.pinned, 'unpinned')
})

await close()
finish()
