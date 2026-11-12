// End-to-end: Hiveory as a server (ADR 0022, 0027, 0052, 0053) driven the way a paired desktop and
// a phone drive it, over HTTP and the event stream. Pairing and its refusals, what a phone may and
// may not call, a terminal streamed to a watching phone, a chat reply reaching clients whole
// (ADR 0068), and a phone too slow to read while a terminal floods (bounded server memory).
// Usage: pnpm build && node scripts/e2e-server.mjs
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { expect, fakeChatCli, finish, fixtures, local, plain, profile, sandbox, shellPath, test } from './e2e-harness.mjs'

const electron = createRequire(import.meta.url)('electron')
const repo = join(sandbox, 'demo-app')
mkdirSync(repo)
for (const args of [['init', '-b', 'main'], ['config', 'user.email', 'e2e@example.test'], ['config', 'user.name', 'e2e']]) execFileSync('git', args, { cwd: repo })
writeFileSync(join(repo, 'README.md'), '# demo\n')
execFileSync('git', ['add', '.'], { cwd: repo })
execFileSync('git', ['commit', '-m', 'init'], { cwd: repo })
const chatCli = fakeChatCli()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── The server ──────────────────────────────────────────────────────────────────────────────

/** Starts `hiveory --serve 0` and resolves with its port and pairing code from stdout. */
const startServer = () =>
  new Promise((resolve, reject) => {
    const args = ['.', '--serve', '0', ...(process.platform === 'linux' ? ['--ozone-platform=headless'] : [])]
    const child = spawn(electron, args, {
      env: { ...process.env, ...chatCli.env, HIVEORY_USER_DATA: profile, LOCALAPPDATA: local, XDG_DATA_HOME: local, HIVEORY_STOP_AGENTS_ON_QUIT: '1' },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let out = ''
    const found = { port: 0, code: '' }
    const timer = setTimeout(() => reject(new Error(`no "ready" line within 60 s:\n${out.slice(-1500)}`)), 60_000)
    const read = (d) => {
      out += String(d)
      found.port ||= Number(/server ready on [^:\s]+:(\d+)/.exec(out)?.[1] ?? 0)
      found.code ||= /Pairing code: (\S+)/.exec(out)?.[1] ?? ''
      if (found.port && found.code) {
        clearTimeout(timer)
        resolve({ child, ...found, log: () => out })
      }
    }
    child.stdout.on('data', read)
    child.stderr.on('data', read)
    child.once('exit', (code) => reject(new Error(`the server exited (${code}):\n${out.slice(-1500)}`)))
  })

let server
let base
const http = (method, path, body, token) =>
  new Promise((resolve, reject) => {
    const req = request(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) } }, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (d) => (text += d))
      res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }))
    })
    req.on('error', reject)
    req.end(body === undefined ? undefined : JSON.stringify(body))
  })
/** A call as a device makes it; resolves with the value, or throws the server's refusal. */
const call = async (token, channel, payload) => {
  const { status, body } = await http('POST', '/call', { channel, payload }, token)
  if (status !== 200 || !body?.ok) throw Object.assign(new Error(`${channel}: ${body?.error?.message ?? body?.error ?? status}`), { status, body })
  return body.value
}

/** Opens the event stream as `token`; events are collected, `read: false` leaves the socket unread (a stalled phone). */
const events = (token, query = '', { read = true } = {}) =>
  new Promise((resolve, reject) => {
    const got = []
    const req = request(`${base}/events${query}`, { headers: { authorization: `Bearer ${token}` } }, (res) => {
      if (!read) {
        res.pause()
        return resolve({ got, close: () => req.destroy(), res })
      }
      let buffer = ''
      res.setEncoding('utf8')
      res.on('data', (d) => {
        buffer += d
        const frames = buffer.split('\n\n')
        buffer = frames.pop()
        for (const f of frames) {
          const data = f.split('\n').find((l) => l.startsWith('data: '))
          if (data) got.push(JSON.parse(data.slice(6)))
        }
      })
      resolve({ got, close: () => req.destroy(), res })
    })
    req.on('error', (e) => (e.code === 'ECONNRESET' ? undefined : reject(e)))
    req.end()
  })

/** Working memory of the server's main process, in MB. */
const serverMb = () => {
  const pid = server.child.pid
  try {
    if (process.platform === 'win32') return Number(execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' }).trim().split('","').at(-1).replace(/\D/g, '')) / 1024
    return Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).trim()) / 1024
  } catch {
    return 0
  }
}
const waitFor = async (fn, message, timeout = 15_000) => {
  const end = Date.now() + timeout
  for (;;) {
    if (await fn()) return
    if (Date.now() > end) throw new Error(`Timed out: ${message}`)
    await sleep(150)
  }
}

let desktop
let phone
let primary
let shellId
let terminal

console.log('Hiveory E2E: server')

await test('the server starts without a window and says where to reach it', async () => {
  server = await startServer()
  base = `http://127.0.0.1:${server.port}`
  const health = await http('GET', '/health')
  expect(health.status === 200 && health.body.app === 'hiveory', `health: ${JSON.stringify(health)}`)
})

await test('pairing: nothing works before it; a wrong code is refused; a code pairs once', async () => {
  expect((await http('POST', '/call', { channel: 'projects.list' })).status === 401, 'an unpaired call was served')
  expect((await http('POST', '/pair', { code: 'WRONG0', name: 'x' })).status === 403, 'a wrong code paired')
  const first = await http('POST', '/pair', { code: server.code, name: 'Laptop', client: 'desktop' })
  expect(first.status === 200 && first.body.token, `pairing failed: ${JSON.stringify(first.body)}`)
  desktop = first.body.token
  expect((await http('POST', '/pair', { code: server.code, name: 'again' })).status === 403, 'a used code paired twice')
  // A fresh code is printed after each pairing.
  await waitFor(async () => /Pairing code: (\S+)[\s\S]*Pairing code: (\S+)/.test(server.log()), 'a new pairing code')
  const codes = [...server.log().matchAll(/Pairing code: (\S+)/g)].map((m) => m[1])
  const second = await http('POST', '/pair', { code: codes.at(-1), name: 'Phone', client: 'mobile' })
  expect(second.status === 200, `phone pairing failed: ${JSON.stringify(second.body)}`)
  phone = second.body.token
})

await test('a paired desktop adds a Workspace by its path on the server and opens a terminal', async () => {
  const project = await call(desktop, 'projects.add', { mode: 'folder', path: repo })
  await waitFor(async () => (primary = (await call(desktop, 'workspaces.list', { projectId: project.id })).find((w) => w.kind === 'main')), 'the primary worktree')
  shellId = (await call(desktop, 'clis.list')).find((c) => c.available && c.kind === 'shell')?.id
  expect(shellId, 'no shell on the server')
  terminal = (await call(desktop, 'agents.open', { workspaceId: primary.id, cliId: shellId })).agent.id
})

await test('a phone may use only its own channels (ADR 0027)', async () => {
  expect((await call(phone, 'projects.list')).length === 1, 'the phone does not see the Workspace')
  let refused = false
  try {
    await call(phone, 'settings.update', { theme: 'dark' })
  } catch {
    refused = true
  }
  expect(refused, 'the phone changed settings it may not')
})

await test('a phone watching a terminal gets its output in order, and sizes it while it watches (ADR 0048)', async () => {
  const stream = await events(phone, `?terminal=${terminal}&cols=60&rows=20`)
  await sleep(500)
  await call(phone, 'terminal.write', { instanceId: terminal, data: `node -e "for (let i = 1; i <= 200; i++) console.log('row-' + i)"\r` })
  const text = () => stream.got.filter((e) => e.event === 'terminal.data').map((e) => e.payload.data).join('')
  await waitFor(async () => /row-200/.test(text()), 'the output reached the phone')
  const chunks = stream.got.filter((e) => e.event === 'terminal.data').map((e) => e.payload)
  for (let i = 1; i < chunks.length; i++) expect(chunks[i].offset === chunks[i - 1].offset + chunks[i - 1].data.length, `a gap or overlap at chunk ${i}`)
  // The terminal may put control sequences before a line's text, so rows are found anywhere.
  const rows = [...text().matchAll(/row-(\d+)\b/g)].map((m) => Number(m[1]))
  expect(rows.join() === Array.from({ length: 200 }, (_, i) => i + 1).join(), `rows arrived as ${rows.slice(0, 10).join()}…`)
  const snap = await call(phone, 'terminal.snapshot', { instanceId: terminal })
  expect(snap.cols === 60 && snap.rows === 20, `the terminal is ${snap.cols}x${snap.rows} while the phone watches, not 60x20`)
  stream.close()
  // Once the phone stops watching, the terminal keeps working at its own size.
  await sleep(1000)
  const end = (await call(desktop, 'terminal.snapshot', { instanceId: terminal })).end
  await call(desktop, 'terminal.write', { instanceId: terminal, data: 'echo still-here-42\r' })
  const after = async () => (await call(desktop, 'terminal.snapshot', { instanceId: terminal })).data
  try {
    await waitFor(async () => /still-here-42[\s\S]*still-here-42/.test(await after()), 'the terminal answered after the phone left', 10_000)
  } catch (error) {
    const snapNow = await call(desktop, 'terminal.snapshot', { instanceId: terminal })
    // eslint-disable-next-line no-control-regex
    const queries = (snapNow.data.slice(-(snapNow.end - end)).match(/\[\??[0-9;]*[nc]/g) ?? []).length
    throw new Error(`${error.message}: ${snapNow.end - end} characters since, ${queries} terminal queries (DSR/DA) among them, at ${snapNow.cols}x${snapNow.rows}; raw ${JSON.stringify(snapNow.data.slice(-(snapNow.end - end)).slice(0, 300))}`, { cause: error })
  }
})

await test('a chat reply reaches paired devices whole on every update, never as deltas (ADR 0068)', async () => {
  chatCli.configure({ lines: 30, everyMs: 60 })
  const { agent } = await call(desktop, 'agents.open', { workspaceId: primary.id, cliId: chatCli.cliId, chatUi: true })
  const stream = await events(phone, '?terminal=none')
  await sleep(300)
  await call(phone, 'chat.send', { chatId: agent.id, text: 'go' })
  await waitFor(async () => stream.got.some((e) => e.event === 'chat.event' && e.payload.message.role === 'assistant' && !e.payload.message.streaming), 'the reply ended', 30_000)
  expect(!stream.got.some((e) => e.event === 'chat.delta'), 'a paired device was sent a delta')
  const replies = stream.got.filter((e) => e.event === 'chat.event' && e.payload.message.role === 'assistant').map((e) => e.payload.message.parts.map((p) => p.text ?? '').join(''))
  expect(replies.length > 3, `only ${replies.length} updates reached the phone`)
  for (let i = 1; i < replies.length; i++) expect(replies[i].startsWith(replies[i - 1]), `update ${i} is not the whole reply so far`)
  expect(replies.at(-1).trimEnd().endsWith('END-OF-REPLY'), 'the last update is not the whole reply')
  stream.close()
})

await test('a phone too slow to read a flooding terminal does not grow the server without bound', async () => {
  const stalled = await events(phone, `?terminal=${terminal}`, { read: false })
  let cut = false
  stalled.res.once('close', () => (cut = true))
  const before = serverMb()
  const printedBefore = (await call(desktop, 'terminal.snapshot', { instanceId: terminal })).end
  // The phone that watched before resized the terminal back on leaving: let the shell redraw first.
  await sleep(1500)
  await call(desktop, 'terminal.write', { instanceId: terminal, data: `node ${shellPath(join(fixtures, 'flood.mjs'))} 0 8` })
  await sleep(300)
  await call(desktop, 'terminal.write', { instanceId: terminal, data: '\r' })
  let peak = before
  for (let i = 0; i < 20; i++) {
    await sleep(500)
    peak = Math.max(peak, serverMb())
  }
  console.log(`      server main process: ${Math.round(before)} MB before, ${Math.round(peak)} MB at most while a stalled phone watched an 8 s flood`)
  const printed = (await call(desktop, 'terminal.snapshot', { instanceId: terminal })).end - printedBefore
  console.log(`      the terminal printed ${Math.round(printed / 1e6)} MB meanwhile`)
  stalled.close()
  const tail = plain((await call(desktop, 'terminal.snapshot', { instanceId: terminal })).data).slice(-400)
  expect(printed > 20e6, `the flood printed only ${printed} characters; the check proves nothing. Screen: ${JSON.stringify(tail)}`)
  expect(peak - before < 300, `the server grew by ${Math.round(peak - before)} MB for one stalled phone`)
  expect(cut, 'the server kept the stalled stream open')
  // The server still answers, and the phone, back, gets live output again (it reads the screen whole first).
  expect((await http('GET', '/health')).status === 200, 'the server stopped answering')
  const back = await events(phone, `?terminal=${terminal}`)
  await sleep(1500)
  await call(phone, 'terminal.write', { instanceId: terminal, data: 'echo back-again-7\r' })
  await waitFor(async () => back.got.some((e) => e.event === 'terminal.data' && e.payload.data.includes('back-again-7')), 'live output after reconnecting', 15_000)
  back.close()
})

await test('the server stops on SIGTERM-like quit and leaves nothing running', async () => {
  const exited = new Promise((r) => server.child.once('exit', r))
  if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(server.child.pid), '/t', '/f'])
  else server.child.kill('SIGTERM')
  await Promise.race([exited, sleep(15_000)])
  expect(server.child.exitCode !== null || server.child.signalCode !== null, 'the server did not stop')
})

finish()
