// End-to-end: CLI logins come from the saved environment (ADR 0063). Hiveory starts with a stale token,
// endpoint and model in its own environment; a terminal pane must not see them, and keeps the rest.
// Usage: pnpm build && node scripts/e2e-login-env.mjs [screenshotDir]
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as h from './e2e-harness.mjs'

const { launch, test, expect, value, waitFor, finish, sandbox } = h
const page = () => h.page

const repo = join(sandbox, 'demo-app')
mkdirSync(repo, { recursive: true })
const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' })
git('init', '-q', '-b', 'main')
git('config', 'user.email', 'e2e@example.test')
git('config', 'user.name', 'e2e')
writeFileSync(join(repo, 'README.md'), '# demo\n')
git('add', '.')
git('commit', '-q', '-m', 'init')

await launch({ ANTHROPIC_AUTH_TOKEN: 'stale-token-xyz', ANTHROPIC_BASE_URL: 'https://old-proxy.example', ANTHROPIC_MODEL: 'old-model-xyz', HIVEORY_CHECK_KEEP: 'kept' })

await test('a terminal pane sees no stale login variables, and keeps the rest', async () => {
  await h.app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
  }, repo)
  await value('projects.pickFolder', { purpose: 'project' })
  const project = await value('projects.add', { mode: 'folder', path: repo })
  await waitFor(async () => (await value('workspaces.list', { projectId: project.id })).some((w) => w.kind === 'main'), 'primary')
  const primary = (await value('workspaces.list', { projectId: project.id })).find((w) => w.kind === 'main')
  const clis = await value('clis.list')
  const cmd = clis.find((c) => c.id === 'cmd' && c.available) ?? clis.find((c) => c.kind === 'shell' && c.available)
  const { agent } = await value('agents.open', { workspaceId: primary.id, cliId: cmd.id })
  await page().waitForTimeout(2500)
  const probe = 'echo [%ANTHROPIC_AUTH_TOKEN%][%ANTHROPIC_BASE_URL%][%ANTHROPIC_MODEL%][%HIVEORY_CHECK_KEEP%]\r'
  const ps = '$x="[$env:ANTHROPIC_AUTH_TOKEN][$env:ANTHROPIC_BASE_URL][$env:ANTHROPIC_MODEL][$env:HIVEORY_CHECK_KEEP]"; "RESULT$x"\r'
  await value('terminal.write', { instanceId: agent.id, data: cmd.id === 'cmd' ? probe : ps })
  await waitFor(async () => (await value('terminal.snapshot', { instanceId: agent.id })).data.includes('kept]'), 'probe printed', 15000)
  const out = (await value('terminal.snapshot', { instanceId: agent.id })).data
  console.log('   pane printed:', out.split(/\r?\n/).filter((l) => l.includes('kept]')).at(-1))
  expect(!out.includes('stale-token-xyz') && !out.includes('old-proxy.example') && !out.includes('old-model-xyz'), 'a stale login variable reached the pane')
})

await h.close()
finish()
