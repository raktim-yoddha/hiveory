/* global window, requestAnimationFrame */
// The end-to-end harness shared by scripts/e2e*.mjs: launches the built app with a throwaway profile,
// runs named tests, and calls the app's IPC. `app` and `page` are live bindings (a relaunch swaps them).
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve, sep } from 'node:path'
import { _electron as electron } from 'playwright-core'

export const shots = resolve(process.argv[2] ?? join(tmpdir(), 'hiveory-e2e'))
mkdirSync(shots, { recursive: true })
export const sandbox = mkdtempSync(join(tmpdir(), 'hiveory-e2e-'))
export const profile = join(sandbox, 'profile')
export const local = join(sandbox, 'local')
/** Where the app under test keeps its terminal host's files (paths.ts, with the environment `launch` sets). */
export const hostDir = join(
  process.platform === 'win32' ? join(local, 'Hiveory Dev') : process.platform === 'darwin' ? profile : join(local, 'hiveory-dev'),
  'Runtime',
  'hiveoryd'
)
/** What the terminal host wrote about itself, for a failure message: its log's end, and how long its socket path is. */
export const hostReport = () => {
  const socket = join(hostDir, 'hiveoryd-3.sock')
  let log = '(no daemon.log)'
  try {
    log = readFileSync(join(hostDir, 'daemon.log'), 'utf8').trim().split('\n').slice(-6).join('\n      ')
  } catch {
    // Never started, or wrote nothing.
  }
  return `socket ${socket} (${Buffer.byteLength(socket)} bytes)\n      daemon.log:\n      ${log}`
}

export const results = []
// Playwright asserts ("Target crashed") when a hidden background page it auto-attached to (a
// browser_crawl worker) is closed. The app is fine — the main window has its own crash handler —
// so that one assertion is logged instead of killing the run.
process.on('uncaughtException', (error) => {
  if (/Target crashed/.test(String(error?.message))) return console.log('  (ignored Playwright assertion: a background page target closed)')
  console.error(error)
  process.exit(1)
})

export let app
export let page
let closing = false
export const launch = async (extraEnv = {}) => {
  // Automated runs never leave agents running in a terminal host after they end (ADR 0050).
  // Windows marks a covered window hidden and stops painting it, so tests would depend on what else
  // is on screen. The window keeps painting while the tests run, even with other windows on top.
  const paint = ['--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding']
  app = await electron.launch({ args: [...paint, '.'], env: { ...process.env, HIVEORY_USER_DATA: profile, LOCALAPPDATA: local, HIVEORY_STOP_AGENTS_ON_QUIT: '1', ...extraEnv } })
  const proc = app.process()
  proc.on('exit', (code, signal) => {
    if (!closing) console.log(`  !! Electron exited unexpectedly (code ${code}, signal ${signal})`)
  })
  proc.stderr?.on('data', (d) => {
    const text = String(d)
    if (/error|fatal|crash/i.test(text) && !/Security Warning|DevTools|Debugger/.test(text)) console.log(`  [stderr] ${text.trim().slice(0, 300)}`)
  })
  page = await app.firstWindow()
  page.on('crash', () => console.log('  !! renderer crashed'))
  page.on('pageerror', (e) => results.push({ name: `pageerror: ${e.message}`, ok: false }))
  // A missing control fails its test in seconds, not half a minute (slow steps pass their own timeout).
  page.setDefaultTimeout(10_000)
  await page.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined)
  await page.waitForSelector('text=Hiveory')
}
export const close = async () => {
  closing = true
  // A terminal host left running (`durableEnv`) inherits the app's output pipes, so Playwright's own
  // close never settles: the process having exited is the end either way.
  const proc = app.process()
  const exited = proc.exitCode !== null ? Promise.resolve() : new Promise((done) => proc.once('exit', done))
  await Promise.race([app.close().catch(() => undefined), exited])
  closing = false
}
/** Quits and starts again; `whileClosed` runs in between (waiting, say, for something to end meanwhile). */
export const relaunch = async (extraEnv = {}, whileClosed) => {
  await close()
  await whileClosed?.()
  await launch(extraEnv)
}

/** The scripts the speed and durability runs start inside terminals and chats (ADR 0066). */
export const fixtures = join(import.meta.dirname, 'e2e-fixtures')
/** A path as a quoted shell argument that cmd, PowerShell and bash all read the same way. */
export const shellPath = (file) => `"${file.split(sep).join('/')}"`

/**
 * Environment for a launch whose terminals and chat turns outlive the app in the terminal host, as
 * they do for users (ADR 0050): its data stays inside the sandbox on every OS. End such a run with
 * `stopTerminalHost`, never `close`, so nothing is left running.
 */
export const durableEnv = () => ({ HIVEORY_STOP_AGENTS_ON_QUIT: '0', XDG_DATA_HOME: local })

/**
 * A stand-in chat CLI: `copilot` on the returned PATH prints plain lines at the pace `configure`
 * sets (its print mode is plain text, so no protocol is faked). Pass `env` to `launch`.
 */
export const fakeChatCli = () => {
  const dir = join(sandbox, 'fake-bin')
  mkdirSync(dir, { recursive: true })
  const script = join(dir, 'fake-chat-cli.mjs')
  copyFileSync(join(fixtures, 'fake-chat-cli.mjs'), script)
  // Shaped like npm's own shims, which Hiveory reads to start the script with Node directly (never through cmd.exe).
  if (process.platform === 'win32') writeFileSync(join(dir, 'copilot.cmd'), `@echo off\r\nnode "%~dp0${sep}fake-chat-cli.mjs" %*\r\n`)
  else {
    writeFileSync(join(dir, 'copilot'), `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`)
    chmodSync(join(dir, 'copilot'), 0o755)
  }
  const configure = (config) => writeFileSync(join(dir, 'fake-chat-cli.json'), JSON.stringify(config))
  configure({})
  // Windows names the variable "Path"; setting a second spelling would leave which one wins to chance.
  const key = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH'
  return { cliId: 'copilot', configure, env: { [key]: `${dir}${delimiter}${process.env[key] ?? ''}` } }
}

const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
/** Quits a `durableEnv` launch with its agents stopped, and makes sure the terminal host is gone. */
export const stopTerminalHost = async () => {
  const pid = await value('terminalHost.status').then((s) => s.pid, () => undefined)
  await app.evaluate(() => {
    process.env.HIVEORY_STOP_AGENTS_ON_QUIT = '1'
  })
  await close()
  // Ending dozens of terminals takes a while on a slow machine (a CI runner): up to 30 s.
  for (let i = 0; pid && alive(pid) && i < 150; i++) await new Promise((r) => setTimeout(r, 200))
  if (pid && alive(pid)) {
    console.log(`  !! the terminal host (pid ${pid}) outlived a quit that stops agents; ending it`)
    process.kill(pid)
  }
}

export const shot = (name) => page.screenshot({ path: join(shots, `${name}.png`) }).catch(() => undefined)
export const test = async (name, fn) => {
  const started = Date.now()
  try {
    await fn()
    results.push({ name, ok: true, ms: Date.now() - started })
    console.log(`  ✓ ${name} (${Date.now() - started} ms)`)
  } catch (error) {
    // fetch failures hide the real reason in error.cause (ECONNRESET, a timeout…).
    const cause = error?.cause ? ` (cause: ${error.cause.code ?? ''} ${error.cause.message ?? error.cause})` : ''
    const message = `${String(error?.message ?? error).split('\n')[0]}${cause} after ${Date.now() - started} ms`
    results.push({ name, ok: false, error: message })
    // Playwright puts the reason (what intercepted a click, which elements matched) on later lines.
    const detail = String(error?.message ?? '').split('\n').slice(1, 8).filter((l) => l.trim()).map((l) => `        ${l.trim()}`).join('\n')
    console.log(`  ✗ ${name}\n      ${message}${detail ? `\n${detail}` : ''}`)
    // Layout tests fail together when the screen itself changes (a sleeping monitor, a locked session):
    // the window's size, the screen and whether the page still draws tell that apart from a real bug.
    const where = await app
      ?.evaluate(({ BrowserWindow, screen }) => {
        const w = BrowserWindow.getAllWindows()[0]
        return { window: w?.getBounds(), minimized: w?.isMinimized(), screens: screen.getAllDisplays().map((d) => `${d.size.width}x${d.size.height}@${d.scaleFactor}`) }
      })
      .catch(() => null)
    const frames = await page
      ?.evaluate(() => new Promise((ok) => { let n = 0; const tick = () => (++n, requestAnimationFrame(tick)); requestAnimationFrame(tick); setTimeout(() => ok(n), 500) }))
      .catch(() => null)
    if (where) console.log(`        (window ${JSON.stringify(where.window)}${where.minimized ? ' minimized' : ''}, screens ${where.screens.join(', ')}, ${frames ?? '?'} frames in 0.5 s)`)
    await shot(`FAIL-${name.replace(/[^a-z0-9]+/gi, '-')}`)
  }
}
export const expect = (cond, message) => {
  if (!cond) throw new Error(message)
}
export const invoke = (channel, payload) => page.evaluate(async ([c, p]) => window.hiveory.invoke(c, p), [channel, payload])
export const value = async (channel, payload) => {
  const r = await invoke(channel, payload)
  if (!r.ok) throw new Error(`${channel}: ${r.error.message}`)
  return r.value
}
export const waitFor = async (fn, message, timeout = 15000) => {
  const end = Date.now() + timeout
  for (;;) {
    if (await fn()) return
    if (Date.now() > end) throw new Error(`Timed out: ${message}`)
    await page.waitForTimeout(150)
  }
}

/** An agent's Hiveory MCP server (its tools), once Hiveory has written the agent's config. */
export const agentMcp = async (agentId) => {
  const file = join(local, 'Hiveory Dev', 'Runtime', agentId, 'hiveory-mcp.json')
  await waitFor(async () => existsSync(file), 'mcp config written')
  const server = JSON.parse(readFileSync(file, 'utf8')).mcpServers.hiveory
  const rpc = async (method, params, id = Math.floor(Math.random() * 1e9)) => {
    const res = await fetch(server.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: server.headers.Authorization },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params })
    })
    return res.json()
  }
  const tool = async (name, args = {}) => (await rpc('tools/call', { name, arguments: args })).result
  return { rpc, tool }
}

// Browser pages are panes (ADR 0042, 0043): the page itself is a native view laid over its pane.
export const browserPane = () => page.locator('section[aria-label$=" browser"]').first()
/** Whether the native view of the page whose address contains `urlPart` is drawn right now. */
export const nativeShown = async (urlPart) =>
  (await app.evaluate(({ BrowserWindow }, part) => BrowserWindow.getAllWindows()[0].contentView.children.filter((v) => v.webContents?.getURL().includes(part)).map((v) => v.getVisible()), urlPart))[0] === true

/** Prints the summary and exits non-zero when anything failed. */
export const finish = () => {
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots: ${shots}`)
  for (const f of failed) console.log(`  FAILED: ${f.name} — ${f.error}`)
  process.exit(failed.length ? 1 : 0)
}
