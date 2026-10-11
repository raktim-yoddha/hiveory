/* global window */
// The end-to-end harness shared by scripts/e2e*.mjs: launches the built app with a throwaway profile,
// runs named tests, and calls the app's IPC. `app` and `page` are live bindings (a relaunch swaps them).
import { mkdirSync, mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'

export const shots = resolve(process.argv[2] ?? join(tmpdir(), 'hiveory-e2e'))
mkdirSync(shots, { recursive: true })
export const sandbox = mkdtempSync(join(tmpdir(), 'hiveory-e2e-'))
export const profile = join(sandbox, 'profile')
export const local = join(sandbox, 'local')

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
export const launch = async () => {
  app = await electron.launch({ args: ['.'], env: { ...process.env, HIVEORY_USER_DATA: profile, LOCALAPPDATA: local } })
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
  await page.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined)
  await page.waitForSelector('text=Hiveory')
}
export const close = async () => {
  closing = true
  await app.close()
  closing = false
}
export const relaunch = async () => {
  await close()
  await launch()
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
