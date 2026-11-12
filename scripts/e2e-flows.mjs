// End-to-end: flows no other suite runs from start to end. A Schedule runs and records its run
// (ADR 0046); a message typed while a chat answers waits and goes in next (ADR 0031); a saved
// prompt is kept; a preset is saved and opens its agents (rule 14); the Sessions list answers.
// Usage: pnpm build && node scripts/e2e-flows.mjs [screenshotDir]
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, close, expect, fakeChatCli, finish, launch, plain, sandbox, test, value, waitFor } from './e2e-harness.mjs'

const repo = join(sandbox, 'demo-app')
mkdirSync(repo)
for (const args of [['init', '-b', 'main'], ['config', 'user.email', 'e2e@example.test'], ['config', 'user.name', 'e2e']]) execFileSync('git', args, { cwd: repo })
writeFileSync(join(repo, 'README.md'), '# demo\n')
execFileSync('git', ['add', '.'], { cwd: repo })
execFileSync('git', ['commit', '-m', 'init'], { cwd: repo })
const chatCli = fakeChatCli()

let project
let primary
let shellId

/** The assistant replies of a chat, as text. */
const replies = async (chatId) =>
  (await value('chat.get', { chatId })).messages.filter((m) => m.role === 'assistant').map((m) => ({ text: m.parts.map((p) => p.text ?? '').join(''), streaming: Boolean(m.streaming), error: m.error }))

console.log('Hiveory E2E: flows')
await launch(chatCli.env)

await test('setup: a Workspace', async () => {
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
  }, repo)
  await value('projects.pickFolder', { purpose: 'project' })
  project = await value('projects.add', { mode: 'folder', path: repo })
  await waitFor(async () => (primary = (await value('workspaces.list', { projectId: project.id })).find((w) => w.kind === 'main')), 'the primary worktree')
  shellId = (await value('clis.list')).find((c) => c.available && c.kind === 'shell')?.id
  expect(shellId, 'no shell is installed')
})

await test('a Schedule run now starts its agent, which answers, and the run is recorded as completed (ADR 0046)', async () => {
  chatCli.configure({ lines: 6, everyMs: 50, end: 'SCHEDULE-DONE' })
  const routine = await value('routines.create', {
    name: 'Nightly check',
    target: { kind: 'workspace', projectId: project.id, workspaceId: primary.id, cliId: chatCli.cliId },
    prompt: 'Say hello.',
    schedule: { kind: 'once' },
    startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    timezone: 'UTC'
  })
  expect((await value('routines.list')).some((r) => r.id === routine.id), 'the Schedule is not listed')
  const run = await value('routines.runNow', { routineId: routine.id })
  expect(run.status === 'running' && run.agentId, `the run did not start: ${JSON.stringify(run)}`)
  let runs = []
  try {
    await waitFor(async () => (runs = await value('routines.runs', { routineId: routine.id })).some((r) => r.status !== 'running'), 'the run ended', 30_000)
  } catch (error) {
    const agent = (await value('agents.list', { workspaceId: primary.id })).find((a) => a.id === run.agentId)
    const screen = plain((await value('terminal.snapshot', { instanceId: run.agentId })).data)
    throw new Error(`${error.message}; its agent: ${JSON.stringify(agent?.runtime)}; screen ends: ${JSON.stringify(screen.slice(-300))}`, { cause: error })
  }
  const ended = runs.find((r) => r.id === run.id)
  expect(ended?.status === 'completed', `the run ended ${ended?.status}: ${ended?.detail}`)
  // The run's agent is a terminal agent: its answer is on its screen.
  const screen = (await value('terminal.snapshot', { instanceId: run.agentId })).data
  expect(screen.includes('SCHEDULE-DONE'), 'the agent of the run did not answer')
  // A second run while one is going is skipped, never doubled.
  chatCli.configure({ lines: 40, everyMs: 100, end: 'SLOW-DONE' })
  const slow = await value('routines.runNow', { routineId: routine.id })
  const again = await value('routines.runNow', { routineId: routine.id })
  expect(slow.status === 'running' && again.status === 'skipped', `second run: ${again.status}`)
  await waitFor(async () => (await value('routines.runs', { routineId: routine.id })).every((r) => r.status !== 'running'), 'the slow run ended', 30_000)
})

await test('a message typed while a chat answers waits, then goes in as the next turn (ADR 0031)', async () => {
  chatCli.configure({ lines: 30, everyMs: 80, end: 'TURN-DONE' })
  const { agent } = await value('agents.open', { workspaceId: primary.id, cliId: chatCli.cliId, chatUi: true })
  await value('chat.send', { chatId: agent.id, text: 'first' })
  await waitFor(async () => (await replies(agent.id)).at(-1)?.streaming, 'the first reply is streaming')
  await value('chat.queue', { chatId: agent.id, text: 'second, while you answer' })
  expect((await value('chat.get', { chatId: agent.id })).queued?.[0] === 'second, while you answer', 'the message is not waiting')
  await waitFor(async () => (await replies(agent.id)).length === 2 && !(await replies(agent.id))[1].streaming, 'the queued message was answered', 30_000)
  const chat = await value('chat.get', { chatId: agent.id })
  const asked = chat.messages.filter((m) => m.role === 'user').map((m) => m.parts.map((p) => p.text ?? '').join(''))
  expect(asked.join('|') === 'first|second, while you answer', `questions in order: ${asked.join('|')}`)
  expect(!chat.queued?.length, 'something is still waiting')
})

await test('a saved prompt is kept and listed; it can be deleted', async () => {
  const saved = await value('prompts.save', { title: 'Review', text: 'Review the diff for bugs.' })
  expect((await value('prompts.list')).some((p) => p.id === saved.id && p.text === 'Review the diff for bugs.'), 'the prompt is not listed')
  await value('prompts.delete', { promptId: saved.id })
  expect(!(await value('prompts.list')).some((p) => p.id === saved.id), 'the prompt was not deleted')
})

await test('a preset is saved with CLIs and counts only, and opens its agents (rule 14)', async () => {
  const preset = await value('presets.save', { name: 'Two shells', cliSelections: [{ cliId: shellId, count: 2 }], autoApprove: false })
  expect(JSON.stringify(Object.keys(preset).sort()).includes('cliSelections') && !('layout' in preset), `the preset holds more than it should: ${Object.keys(preset)}`)
  const worktree = await value('workspaces.create', { projectId: project.id, kind: 'isolated', name: 'from-preset', cliSelections: [], autoApprove: false })
  await value('agents.applyPreset', { workspaceId: worktree.id, presetId: preset.id })
  let agents = []
  await waitFor(async () => (agents = await value('agents.list', { workspaceId: worktree.id })).length === 2, 'the preset opened its two agents')
  expect(agents.every((a) => a.cliId === shellId) && new Set(agents.map((a) => a.petName)).size === 2, 'the agents are not two distinct shells')
  await value('presets.delete', { presetId: preset.id })
})

await test('the Sessions list answers for a worktree, a Workspace and everything', async () => {
  for (const scope of [{ scope: 'workspace', workspaceId: primary.id }, { scope: 'project', projectId: project.id }, { scope: 'all' }]) {
    const sessions = await value('sessions.list', scope)
    expect(Array.isArray(sessions), `sessions.list ${scope.scope} did not answer a list`)
  }
})

await close()
finish()
