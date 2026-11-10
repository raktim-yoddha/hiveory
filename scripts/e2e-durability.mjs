// End-to-end: what must survive closing Hiveory (ADR 0050, 0051; guarded by ADR 0066). A terminal
// keeps running through a quit and is taken back with its screen; a chat reply still streaming
// carries on; one that ended while Hiveory was closed is finished from what it printed.
// (Hooks kept and replayed while closed are covered by local-daemon.test.ts.)
// Usage: pnpm build && node scripts/e2e-durability.mjs [screenshotDir]
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, durableEnv, expect, fakeChatCli, finish, fixtures, launch, relaunch, sandbox, shellPath, shot, stopTerminalHost, test, value, waitFor } from './e2e-harness.mjs'

const repo = join(sandbox, 'demo-app')
mkdirSync(repo)
for (const args of [['init', '-b', 'main'], ['config', 'user.email', 'e2e@example.test'], ['config', 'user.name', 'e2e']]) execFileSync('git', args, { cwd: repo })
writeFileSync(join(repo, 'README.md'), '# demo\n')
execFileSync('git', ['add', '.'], { cwd: repo })
execFileSync('git', ['commit', '-m', 'init'], { cwd: repo })

const chatCli = fakeChatCli()
const env = { ...durableEnv(), ...chatCli.env }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** What a terminal has printed so far ('' until it exists). */
const screen = async (instanceId) => (await value('terminal.snapshot', { instanceId }).catch(() => ({ data: '' }))).data
const ticks = (text) => [...text.matchAll(/boot=(\w+) tick=(\d+) /g)].map((m) => ({ boot: m[1], tick: Number(m[2]) }))
/** The reply's text so far, and whether it is still being written. */
const reply = async (chatId) => {
  const chat = await value('chat.get', { chatId })
  const last = chat.messages.filter((m) => m.role === 'assistant').at(-1)
  return { text: (last?.parts ?? []).map((p) => p.text ?? '').join(''), streaming: Boolean(last?.streaming), error: last?.error, running: chat.running }
}
/** Every numbered line, once, in order, then the end marker: nothing lost, nothing printed twice. */
const expectWhole = (text, lines) => {
  const seen = [...text.matchAll(/^L(\d+) /gm)].map((m) => Number(m[1]))
  const wanted = Array.from({ length: lines }, (_, i) => i + 1).filter((n) => n % 25 !== 0 && n % 40 !== 1)
  expect(seen.join() === wanted.join(), `the reply has lines ${seen.slice(0, 12).join()}… (${seen.length}), expected ${wanted.length} in order`)
  expect(text.trimEnd().endsWith('END-OF-REPLY'), 'the reply does not end with its last line')
}

let primary
let shellId

console.log('Hiveory E2E: durability')
await launch(env)

await test('setup: a Workspace whose terminals run in the terminal host', async () => {
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
  }, repo)
  await value('projects.pickFolder', { purpose: 'project' })
  const project = await value('projects.add', { mode: 'folder', path: repo })
  await waitFor(async () => (primary = (await value('workspaces.list', { projectId: project.id })).find((w) => w.kind === 'main')), 'the primary worktree')
  shellId = (await value('clis.list')).find((c) => c.available && c.kind === 'shell')?.id
  expect(shellId, 'no shell is installed')
  expect((await value('chat.clis')).includes(chatCli.cliId), 'the stand-in chat CLI was not found on PATH')
})

await test('a terminal keeps running through quit and reopen, and comes back with its screen', async () => {
  const { agent } = await value('agents.open', { workspaceId: primary.id, cliId: shellId })
  await waitFor(async () => (await screen(agent.id)).length > 0, 'the shell started')
  await value('terminal.write', { instanceId: agent.id, data: `node ${shellPath(join(fixtures, 'counter.mjs'))}\r` })
  await waitFor(async () => ticks(await screen(agent.id)).some((t) => t.tick >= 3), 'the counter runs')
  const host = await value('terminalHost.status')
  expect(host.mode === 'daemon', `terminals run in "${host.mode}", not in the terminal host that outlives Hiveory`)
  const before = ticks(await screen(agent.id))
  const boot = before[0].boot
  const closedAt = Date.now()

  await relaunch(env)
  const away = Date.now() - closedAt
  await waitFor(async () => ticks(await screen(agent.id)).some((t) => t.boot === boot && t.tick > before.at(-1).tick + 2), 'the same process prints on after the reopen', 30_000)
  const after = ticks(await screen(agent.id))
  expect(new Set(after.map((t) => t.boot)).size === 1, `a second process started: ${[...new Set(after.map((t) => t.boot))].join(', ')}`)
  expect(after.some((t) => t.tick === 1), 'what it printed before the quit is gone from the screen')
  // It printed a line every 400 ms while Hiveory was closed: those lines are on the screen too.
  const numbers = after.map((t) => t.tick)
  const gaps = numbers.filter((n, i) => i > 0 && n !== numbers[i - 1] + 1)
  expect(!gaps.length, `lines printed while Hiveory was closed (${away} ms) are missing before ${gaps.join(', ')}`)
  const now = await value('terminalHost.status')
  expect(now.mode === 'daemon' && now.pid === host.pid, `the terminal host changed (pid ${host.pid} → ${now.pid}, ${now.mode})`)
  const view = (await value('agents.list', { workspaceId: primary.id })).find((a) => a.id === agent.id)
  expect(view?.runtime.running, 'the agent does not read as running after the reopen')
  await shot('d1-terminal-kept')
})

await test('a chat reply still streaming carries on through quit and reopen', async () => {
  const lines = 60
  chatCli.configure({ lines, everyMs: 250 })
  const { agent } = await value('agents.open', { workspaceId: primary.id, cliId: chatCli.cliId, chatUi: true })
  await value('chat.send', { chatId: agent.id, text: 'go' })
  await waitFor(async () => /^L3 /m.test((await reply(agent.id)).text), 'the reply started')

  await relaunch(env)
  const back = await reply(agent.id)
  expect(back.streaming && back.running, `the reply did not carry on after the reopen (streaming ${back.streaming}, running ${back.running}, error ${back.error})`)
  await waitFor(async () => !(await reply(agent.id)).streaming, 'the reply finished', 40_000)
  const done = await reply(agent.id)
  expect(!done.error, `the reply ended with "${done.error}"`)
  expectWhole(done.text, lines)
  await shot('d2-chat-carried-on')
})

await test('a chat reply that ends while Hiveory is closed is whole on reopen', async () => {
  const lines = 16
  chatCli.configure({ lines, everyMs: 250 })
  const { agent } = await value('agents.open', { workspaceId: primary.id, cliId: chatCli.cliId, chatUi: true })
  await value('chat.send', { chatId: agent.id, text: 'go' })
  await waitFor(async () => /^L2 /m.test((await reply(agent.id)).text), 'the reply started')

  // Closed for longer than the rest of the reply takes (16 lines, four a second).
  await relaunch(env, async () => sleep(6000))
  await waitFor(async () => !(await reply(agent.id)).streaming, 'the reply is settled', 15_000)
  const done = await reply(agent.id)
  expect(!done.error, `the reply ended with "${done.error}"`)
  expectWhole(done.text, lines)
})

await test('quitting with agents stopped ends the terminal host', async () => {
  const { pid } = await value('terminalHost.status')
  await stopTerminalHost()
  let gone = true
  try {
    process.kill(pid, 0)
    gone = false
  } catch {
    // No such process: it ended.
  }
  expect(gone, `the terminal host (pid ${pid}) is still running`)
})

finish()
