/* global window, document, requestAnimationFrame */
// How fast Hiveory is, in numbers (ADR 0066): start-up, the window's answer to clicks, six agents
// printing at once, a terminal flood, a long chat reply, and memory. Terminals run in the terminal
// host, as they do for users. Each number is checked against the recorded baseline
// (scripts/perf-baseline.json) and reported against its goal.
// Usage: pnpm build && node scripts/e2e-perf.mjs [outputDir]
//   HIVEORY_PERF=record  writes this run as the new baseline
//   HIVEORY_PERF=report  prints the numbers without failing on them (other machines, CI)
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, close, durableEnv, expect, fakeChatCli, finish, fixtures, launch, page, profile, sandbox, shellPath, shots, stopTerminalHost, test, value, waitFor } from './e2e-harness.mjs'

const repo = join(sandbox, 'demo-app')
mkdirSync(repo)
for (const args of [['init', '-b', 'main'], ['config', 'user.email', 'e2e@example.test'], ['config', 'user.name', 'e2e']]) execFileSync('git', args, { cwd: repo })
writeFileSync(join(repo, 'README.md'), '# demo\n')
execFileSync('git', ['add', '.'], { cwd: repo })
execFileSync('git', ['commit', '-m', 'init'], { cwd: repo })

const mode = process.env.HIVEORY_PERF ?? 'check'
const baselineFile = join(import.meta.dirname, 'perf-baseline.json')
const chatCli = fakeChatCli()
const env = { ...durableEnv(), ...chatCli.env }
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const round = (n) => Math.round(n * 10) / 10

/**
 * Every number this run measures. `goal` is where the speed plan (docs/plans/speed-and-memory.md)
 * wants it; a number may miss its goal, but it may not get worse than the baseline allows.
 */
const metrics = {}
const record = (name, valueNow, unit, { goal, higherIsBetter = false, compare = true } = {}) => {
  metrics[name] = { value: round(valueNow), unit, ...(goal !== undefined ? { goal } : {}), ...(higherIsBetter ? { higherIsBetter } : {}), ...(compare ? {} : { compare }) }
  const met = goal === undefined ? '' : (higherIsBetter ? valueNow >= goal : valueNow <= goal) ? `  (goal ${goal}: met)` : `  (goal ${goal}: not yet)`
  console.log(`      ${name}: ${round(valueNow)} ${unit}${met}`)
}

// ── Start-up ────────────────────────────────────────────────────────────────────────────────

/** Launch to the first drawn window, in ms: the best of four, since whatever else the machine does only ever adds. */
const startup = async () => {
  const runs = []
  for (let i = 0; i < 4; i++) {
    const started = Date.now()
    await launch()
    runs.push(Date.now() - started)
    await close()
  }
  return Math.min(...runs)
}

const seededChats = 200
/** Chat history as a long-time user has it: `seededChats` chats of forty messages each (about 12 MB). */
const seedChats = () => {
  const dir = join(profile, 'chats')
  mkdirSync(dir, { recursive: true })
  const text = 'A paragraph of an answer with some `code` in it and a [link](https://example.test). '.repeat(18)
  const at = new Date(0).toISOString()
  for (let c = 0; c < seededChats; c++) {
    const id = `seed-chat-${String(c).padStart(3, '0')}`
    const messages = Array.from({ length: 40 }, (_, m) => ({ id: `${id}-m${m}`, role: m % 2 ? 'assistant' : 'user', parts: [{ kind: 'text', text }], createdAt: at }))
    writeFileSync(join(dir, `${id}.json`), JSON.stringify({ id, title: `Seeded chat ${c}`, cwd: repo, autoApprove: false, messages, createdAt: at, updatedAt: at }))
  }
  return () => {
    for (let c = 0; c < seededChats; c++) rmSync(join(dir, `seed-chat-${String(c).padStart(3, '0')}.json`), { force: true })
  }
}

console.log('Hiveory E2E: speed')
await test('start-up: an empty profile, then one with a long chat history', async () => {
  // The first launch ever creates the profile; it is not measured.
  await launch()
  await close()
  const empty = await startup()
  const unseed = seedChats()
  const withChats = await startup()
  unseed()
  record('startup.empty', empty, 'ms')
  record('startup.withChatHistory', withChats, 'ms')
  // The difference of two timings that each vary by tens of ms: reported against its goal, not compared.
  record('startup.chatHistoryCost', Math.max(0, withChats - empty), 'ms', { goal: 100, compare: false })
})

// ── Probes ──────────────────────────────────────────────────────────────────────────────────

await launch(env)
/** What Chromium says about the window's GPU contexts (ADR 0069). */
const webglWarnings = []
page.on('console', (m) => {
  if (/WebGL contexts|webglcontextlost/i.test(m.text())) webglWarnings.push(m.text())
})

/** CPU seconds each kind of process has used so far (the terminal host is not Electron's, so not here). */
const cpuSeconds = async () => {
  const processes = await app.evaluate(({ app: a }) => a.getAppMetrics().map((m) => ({ type: m.type, seconds: m.cpu.cumulativeCPUUsage ?? 0 })))
  const sum = (type) => processes.filter((p) => p.type === type).reduce((n, p) => n + p.seconds, 0)
  return { main: sum('Browser'), window: sum('Tab'), gpu: sum('GPU') }
}
/** Where the window's main thread spent its time so far, in seconds (Chromium's own counters). */
let devtools
const windowSeconds = async () => {
  devtools ??= await page.context().newCDPSession(page)
  await devtools.send('Performance.enable')
  const { metrics: list } = await devtools.send('Performance.getMetrics')
  const of = (name) => list.find((m) => m.name === name)?.value ?? 0
  return { busy: of('TaskDuration'), script: of('ScriptDuration'), layout: of('LayoutDuration') + of('RecalcStyleDuration') }
}
let probe

/**
 * Starts measuring: main's event-loop delay, the window's long tasks and drawn frames, and the CPU
 * each process uses. `frames: false` leaves the window alone (counting frames makes it draw every one).
 */
const startProbe = async ({ frames = true } = {}) => {
  probe = { at: Date.now(), cpu: await cpuSeconds(), win: await windowSeconds() }
  await app.evaluate(() => {
    globalThis.__loop?.disable()
    globalThis.__loop = process.getBuiltinModule('node:perf_hooks').monitorEventLoopDelay({ resolution: 10 })
    globalThis.__loop.enable()
  })
  await page.evaluate(() => {
    window.__long = []
    window.__obs?.disconnect()
    window.__obs = new PerformanceObserver((list) => window.__long.push(...list.getEntries().map((e) => e.duration)))
    window.__obs.observe({ type: 'longtask', buffered: false })
    window.__frames = 0
    window.__probing = true
    window.__since = performance.now()
  })
  if (!frames) return
  await page.evaluate(() => {
    const tick = () => {
      if (!window.__probing) return
      window.__frames++
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}
/** Ends a measurement. Delays are what the timer was late by, beyond its own 10 ms. */
const stopProbe = async () => {
  const main = await app.evaluate(() => {
    const h = globalThis.__loop
    h.disable()
    const late = (ns) => Math.max(0, ns / 1e6 - 10)
    return { p50: late(h.percentile(50)), p99: late(h.percentile(99)), max: late(h.max) }
  })
  const win = await page.evaluate(() => {
    window.__probing = false
    window.__obs.disconnect()
    return { fps: window.__frames / ((performance.now() - window.__since) / 1000), longest: Math.max(0, ...window.__long), blocked: window.__long.reduce((a, b) => a + b, 0) }
  })
  // As percentages of the time measured: of one CPU core for processes, of its main thread for the window.
  const took = (Date.now() - probe.at) / 1000
  const [cpuNow, winNow] = [await cpuSeconds(), await windowSeconds()]
  const share = (now, before) => ((now - before) / took) * 100
  const cpu = { main: share(cpuNow.main, probe.cpu.main), window: share(cpuNow.window, probe.cpu.window), gpu: share(cpuNow.gpu, probe.cpu.gpu) }
  const thread = { busy: share(winNow.busy, probe.win.busy), script: share(winNow.script, probe.win.script), layout: share(winNow.layout, probe.win.layout) }
  return { main, win, cpu, thread }
}

/**
 * Where the time went. Under load these swing by a third between runs (power, heat, display rate),
 * so they are reported, to steer by; `compare` is for the idle numbers, which hold still.
 */
const recordWork = (name, { cpu, thread }, compare = false) => {
  record(`${name}.cpuMain`, cpu.main, '% of a core', { compare })
  record(`${name}.cpuWindow`, cpu.window, '% of a core', { compare })
  record(`${name}.cpuGpu`, cpu.gpu, '% of a core', { compare })
  record(`${name}.windowScript`, thread.script, '% of its thread', { compare })
  record(`${name}.windowLayout`, thread.layout, '% of its thread', { compare })
}

/** Types `data` into a terminal and times its echo reaching the window, in ms (null: none within 3 s). */
const echo = (instanceId, data) =>
  page.evaluate(
    ([id, text]) =>
      new Promise((resolve) => {
        const started = performance.now()
        let off = () => undefined
        const timer = setTimeout(() => {
          off()
          resolve(null)
        }, 3000)
        off = window.hiveory.on('terminal.data', (p) => {
          if (p.instanceId !== id) return
          clearTimeout(timer)
          off()
          resolve(performance.now() - started)
        })
        void window.hiveory.invoke('terminal.write', { instanceId: id, data: text })
      }),
    [instanceId, data]
  )

const printed = async (ids) => (await Promise.all(ids.map((instanceId) => value('terminal.snapshot', { instanceId })))).reduce((sum, s) => sum + s.end, 0)

/** `node flood.mjs <rate> <seconds>`: lines printed at `rate` characters a second (0: as fast as it can). */
const flood = (rate) => (lasts) => `node ${shellPath(join(fixtures, 'flood.mjs'))} ${rate} ${lasts}`
/** `node tui.mjs <mode> <fps> <seconds>`: a screen redrawn in place, as agent CLIs draw. */
const tui = (mode, fps) => (lasts) => `node ${shellPath(join(fixtures, 'tui.mjs'))} ${mode} ${fps} ${lasts}`

/**
 * Runs `command(seconds, index)` in each of `loud`, and for `seconds` measures the app while
 * typing into `typist`, a quiet terminal beside them.
 */
const underOutput = async (name, loud, typist, command, seconds, { windowCompare = true } = {}) => {
  const lasts = seconds + 3
  for (const [index, instanceId] of loud.entries()) await value('terminal.write', { instanceId, data: `${command(lasts, index)}\r` })
  await page.waitForTimeout(1200)
  const before = await printed(loud)
  await startProbe()
  const started = Date.now()
  const echoes = []
  while (Date.now() - started < seconds * 1000) {
    // A character, then the backspace that takes it away: two echoes, and the prompt stays empty.
    echoes.push(await echo(typist, 'x'), await echo(typist, '\x7f'))
    await page.waitForTimeout(250)
  }
  const work = await stopProbe()
  const { main, win } = work
  const took = (Date.now() - started) / 1000
  const after = await printed(loud)
  expect(after - before > 50_000, `${name}: the terminals printed only ${after - before} characters; is node on PATH?`)
  // No echo within three seconds counts as three seconds.
  const times = echoes.map((e) => e ?? 3000)
  record(`${name}.mainDelayP99`, main.p99, 'ms', { goal: 50 })
  record(`${name}.mainDelayMax`, main.max, 'ms', { goal: 100 })
  record(`${name}.windowLongestTask`, win.longest, 'ms', { goal: 50, compare: windowCompare })
  record(`${name}.windowFps`, win.fps, 'fps', { goal: 50, higherIsBetter: true, compare: windowCompare })
  record(`${name}.typingEchoP50`, median(times), 'ms', { goal: 50, compare: windowCompare })
  // The slowest of a few dozen keystrokes: one hiccup moves it, so it is reported, not compared.
  record(`${name}.typingEchoMax`, Math.max(...times), 'ms', { goal: 100, compare: false })
  // Whatever the machine, the app never freezes under output (ADR 0067).
  expect(main.max < 1000, `${name}: the main process ran ${Math.round(main.max)} ms late`)
  expect(win.longest < 1000, `${name}: the window was blocked for ${Math.round(win.longest)} ms`)
  expect(median(times) < 1000, `${name}: a typed character took ${Math.round(median(times))} ms to echo`)
  // How much was printed, for reading the numbers above; not a speed to hold.
  record(`${name}.outputPerSecond`, (after - before) / took / 1000, 'k chars/s', { compare: false })
  if (windowCompare) recordWork(name, work)
  // Let the output end before the next measurement starts.
  await page.waitForTimeout((lasts - seconds) * 1000 + 500)
}

const megabytes = async () => {
  const processes = await app.evaluate(({ app: a }) => a.getAppMetrics().map((m) => ({ type: m.type, kb: m.memory.workingSetSize })))
  const sum = (type) => processes.filter((p) => p.type === type).reduce((n, p) => n + p.kb, 0) / 1024
  const { pid } = await value('terminalHost.status')
  let host = 0
  try {
    if (pid && process.platform === 'win32') host = Number(execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' }).trim().split('","').at(-1).replace(/\D/g, '')) / 1024
    else if (pid) host = Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).trim()) / 1024
  } catch {
    // Reported as 0: the host's memory could not be read on this system.
  }
  return { main: sum('Browser'), window: sum('Tab'), gpu: sum('GPU'), host, total: processes.reduce((n, p) => n + p.kb, 0) / 1024 + host }
}

// ── The window's answer to clicks (four terminals on screen) ─────────────────────────────────

/** Clicks, then measures: ms to the next painted frame, and the long tasks that followed. */
const measure = async (locator) => {
  await page.evaluate(() => {
    window.__long = []
    window.__obs?.disconnect()
    window.__obs = new PerformanceObserver((list) => window.__long.push(...list.getEntries().map((e) => ({ start: e.startTime, ms: e.duration }))))
    window.__obs.observe({ type: 'longtask', buffered: false })
  })
  const t0 = await page.evaluate(() => performance.now())
  await locator.click()
  const frame = await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(performance.now())))))
  await page.waitForTimeout(900)
  const long = await page.evaluate(() => window.__long)
  return { frame: Math.round(frame - t0), longest: Math.round(Math.max(0, ...long.map((l) => l.ms))), blocked: Math.round(long.reduce((a, l) => a + l.ms, 0)) }
}
const clicks = {}
const report = (name, runs) => {
  const pick = (k) => median(runs.map((r) => r[k]))
  clicks[name] = { frame: pick('frame'), longest: pick('longest') }
  record(`click.${name}.nextFrame`, pick('frame'), 'ms', { goal: 67 })
  record(`click.${name}.longestTask`, pick('longest'), 'ms', { goal: 100 })
}

let primary
let shell
let chatAgent
const terminals = []

await test('memory: an empty window (what Electron and Hiveory cost before any work)', async () => {
  await page.waitForTimeout(3000)
  const processes = await app.evaluate(({ app: a }) => a.getAppMetrics().map((m) => ({ type: m.type, kb: m.memory.workingSetSize })))
  const sum = (type) => processes.filter((p) => p.type === type).reduce((n, p) => n + p.kb, 0) / 1024
  record('memory.empty.total', processes.reduce((n, p) => n + p.kb, 0) / 1024, 'MB')
  record('memory.empty.main', sum('Browser'), 'MB')
  record('memory.empty.window', sum('Tab'), 'MB')
  record('memory.empty.gpu', sum('GPU'), 'MB')
})

await test('setup: a worktree with four terminals', async () => {
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
  }, repo)
  await value('projects.pickFolder', { purpose: 'project' })
  const project = await value('projects.add', { mode: 'folder', path: repo })
  await waitFor(async () => (primary = (await value('workspaces.list', { projectId: project.id })).find((w) => w.kind === 'main')), 'the primary worktree')
  shell = (await value('clis.list')).find((c) => c.available && c.kind === 'shell')
  expect(shell, 'no shell is installed')
  for (let i = 0; i < 4; i++) terminals.push((await value('agents.open', { workspaceId: primary.id, cliId: shell.id })).agent.id)
  const sidebar = page.getByRole('navigation', { name: 'Workspaces' })
  const row = sidebar.getByRole('button', { name: 'demo-app, primary worktree' })
  if (!(await row.isVisible())) await sidebar.getByRole('button', { name: /^demo-app: open/ }).click()
  if (await row.isVisible()) await row.click()
  await waitFor(async () => (await page.locator('.xterm').count()) >= 4, 'four terminals on screen')
  await page.waitForTimeout(1500)
  expect((await value('terminalHost.status')).mode === 'daemon', 'terminals do not run in the terminal host')
})

await test('memory: four idle terminals', async () => {
  const mb = await megabytes()
  record('memory.idle.total', mb.total, 'MB')
  record('memory.idle.main', mb.main, 'MB')
  record('memory.idle.window', mb.window, 'MB')
  record('memory.idle.gpu', mb.gpu, 'MB')
  record('memory.idle.terminalHost', mb.host, 'MB')
})

await test('idle: four terminals at their prompts, nobody typing', async () => {
  // What Hiveory costs while nothing happens. The window is not asked for frames, so it draws only what it would anyway.
  await page.waitForTimeout(1000)
  await startProbe({ frames: false })
  await page.waitForTimeout(6000)
  recordWork('idle', await stopProbe(), true)
  // The other measurements count frames, which makes the window produce one on every display
  // refresh. This is what that alone costs, to read their CPU numbers against.
  await startProbe()
  await page.waitForTimeout(4000)
  const counting = await stopProbe()
  record('probe.frameCountingCpuWindow', counting.cpu.window, '% of a core', { compare: false })
  record('probe.frameCountingCpuGpu', counting.cpu.gpu, '% of a core', { compare: false })
})

await test('toggling the left sidebar', async () => {
  const runs = []
  for (let i = 0; i < 4; i++) {
    runs.push(await measure(page.getByRole('button', { name: 'Hide sidebar' }).first()))
    runs.push(await measure(page.getByRole('button', { name: 'Show sidebar' }).first()))
  }
  report('sidebar', runs)
})

await test('toggling the side panel', async () => {
  const runs = []
  for (let i = 0; i < 4; i++) {
    runs.push(await measure(page.getByRole('button', { name: 'Show side panel' }).first()))
    runs.push(await measure(page.getByRole('button', { name: 'Hide side panel' }).first()))
  }
  report('sidePanel', runs)
})

await test('switching between two worktrees with terminals', async () => {
  const project = (await value('projects.list')).find((p) => p.name === 'demo-app')
  const other = await value('workspaces.create', { projectId: project.id, kind: 'isolated', name: 'other', cliSelections: [], autoApprove: false })
  for (let i = 0; i < 2; i++) await value('agents.open', { workspaceId: other.id, cliId: shell.id })
  const sidebar = page.getByRole('navigation', { name: 'Workspaces' })
  const primaryRow = sidebar.getByRole('button', { name: 'demo-app, primary worktree' })
  const otherRow = sidebar.getByRole('button', { name: 'other' }).first()
  await otherRow.waitFor()
  const runs = []
  for (let i = 0; i < 4; i++) {
    runs.push(await measure(otherRow))
    runs.push(await measure(primaryRow))
  }
  report('worktreeSwitch', runs)
})

await test('switching between three Worktrees of six terminals never costs a terminal its GPU renderer (ADR 0069)', async () => {
  // Chromium keeps about 16 WebGL contexts per window and drops the oldest past that; a terminal
  // whose context is dropped falls back to slow DOM drawing for good.
  const project = (await value('projects.list')).find((p) => p.name === 'demo-app')
  const names = ['many-a', 'many-b', 'many-c']
  for (const name of names) {
    const worktree = await value('workspaces.create', { projectId: project.id, kind: 'isolated', name, cliSelections: [], autoApprove: false })
    for (let i = 0; i < 6; i++) await value('agents.open', { workspaceId: worktree.id, cliId: shell.id })
  }
  const sidebar = page.getByRole('navigation', { name: 'Workspaces' })
  const before = webglWarnings.length
  try {
  for (let round = 0; round < 3; round++) {
    for (const name of names) {
      await sidebar.getByRole('button', { name, exact: true }).first().click()
      await waitFor(async () => (await page.locator('.xterm-screen').count()) >= 6, `the terminals of ${name}`)
      await page.waitForTimeout(400)
    }
  }
  // Every terminal on screen draws with WebGL (a canvas that is not a 2D one), when the machine has WebGL at all.
  const { webgl, gpuDrawn } = await page.evaluate(() => ({
    webgl: Boolean(document.createElement('canvas').getContext('webgl2')),
    gpuDrawn: [...document.querySelectorAll('.xterm-screen')].map((s) => [...s.querySelectorAll('canvas')].some((c) => c.getContext('2d') === null))
  }))
  if (!webgl) console.log('      this machine has no WebGL: terminals draw with the DOM, only dropped contexts are checked')
  const mb = await megabytes()
  record('memory.manyWorktrees.gpu', mb.gpu, 'MB')
  record('memory.manyWorktrees.window', mb.window, 'MB')
  expect(webglWarnings.length === before, `Chromium dropped GPU contexts: ${webglWarnings.slice(before).join(' / ')}`)
  expect(gpuDrawn.length >= 6 && (!webgl || gpuDrawn.every(Boolean)), `terminals on screen drawn without the GPU: ${gpuDrawn.filter((d) => !d).length} of ${gpuDrawn.length}`)
  } finally {
    // The measurements after this one use the primary worktree's terminals.
    await sidebar.getByRole('button', { name: 'demo-app, primary worktree' }).click()
    await waitFor(async () => (await page.locator('.xterm-screen').count()) >= 4, 'back on the primary worktree')
  }
})

await test('opening Settings', async () => {
  const runs = []
  for (let i = 0; i < 3; i++) {
    runs.push(await measure(page.getByRole('button', { name: 'Settings' }).first()))
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
  }
  report('settings', runs)
})

await test('budgets: every action paints within a few frames and never blocks for long', async () => {
  // A shared CI runner is slower than any user's machine: there the numbers are reported only.
  if (mode === 'report') return console.log('      not held (report only)')
  for (const [name, r] of Object.entries(clicks)) {
    // Four frames at 60 Hz: the click's own frame, layout, paint, and one spare for a busy machine.
    expect(r.frame <= 67, `${name}: next frame after ${r.frame} ms`)
    expect(r.longest <= 100, `${name}: a ${r.longest} ms long task`)
  }
})

// ── Agents printing ─────────────────────────────────────────────────────────────────────────

await test('six agents printing at once (250,000 characters a second each), typing into a seventh', async () => {
  for (let i = 0; i < 3; i++) terminals.push((await value('agents.open', { workspaceId: primary.id, cliId: shell.id })).agent.id)
  await waitFor(async () => (await page.locator('.xterm').count()) >= 7, 'seven terminals on screen')
  await page.waitForTimeout(1500)
  await underOutput('busy', terminals.slice(0, 6), terminals[6], flood(250_000), 6)
})

await test('six agent CLIs redrawing their screens (three in place at 20 fps, three full screen at 30 fps), typing into a seventh', async () => {
  // What agents do most of the time: not printing lines, but redrawing a status box or the whole screen.
  await underOutput('redraw', terminals.slice(0, 6), terminals[6], (lasts, index) => (index < 3 ? tui('inline', 20) : tui('fullscreen', 30))(lasts), 6)
})

await test('two terminals printing as fast as they can, typing into another', async () => {
  // Flow control (ADR 0067) keeps this from freezing the app: the programs wait for the window. The
  // window then draws as fast as the machine lets it, which varies twofold between runs (power and
  // heat), so its numbers are held to "never frozen" and their goals, not to the baseline.
  await underOutput('flood', terminals.slice(0, 2), terminals[6], flood(0), 5, { windowCompare: false })
})

await test('memory: right after the flood', async () => {
  const mb = await megabytes()
  record('memory.afterFlood.window', mb.window, 'MB', { goal: 400 })
  // Swings between 160 and 260 MB with when the collector last ran: reported, not compared.
  record('memory.afterFlood.main', mb.main, 'MB', { compare: false })
  record('memory.afterFlood.terminalHost', mb.host, 'MB')
})

// ── A long chat reply ───────────────────────────────────────────────────────────────────────

await test('a 50,000-character chat reply, streamed over ten seconds', async () => {
  const lines = 500
  chatCli.configure({ lines, lineChars: 100, everyMs: 20 })
  const { agent } = await value('agents.open', { workspaceId: primary.id, cliId: chatCli.cliId, chatUi: true })
  chatAgent = agent
  // What crosses to the window for this reply: the events, and the reply text they carry.
  await app.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents
    const send = contents.send.bind(contents)
    globalThis.__chatIpc = { events: 0, chars: 0 }
    contents.send = (channel, payload) => {
      if (channel.endsWith('chat.event') || channel.endsWith('chat.delta')) {
        globalThis.__chatIpc.events++
        for (const part of payload?.message?.parts ?? []) globalThis.__chatIpc.chars += part.text?.length ?? 0
        globalThis.__chatIpc.chars += payload?.append?.length ?? 0
      }
      return send(channel, payload)
    }
  })
  await page.evaluate((chatId) => {
    window.__chatDone = false
    window.hiveory.on('chat.event', (e) => {
      if (e.chatId === chatId && e.message.role === 'assistant' && !e.message.streaming) window.__chatDone = true
    })
  }, agent.id)
  await page.waitForTimeout(500)
  await startProbe()
  await value('chat.send', { chatId: agent.id, text: 'go' })
  await page.waitForFunction(() => window.__chatDone, null, { timeout: 60_000 })
  const work = await stopProbe()
  const { main, win } = work
  const chat = await value('chat.get', { chatId: agent.id })
  const text = chat.messages.at(-1).parts.map((p) => p.text ?? '').join('')
  expect(text.trimEnd().endsWith('END-OF-REPLY') && !chat.messages.at(-1).error, 'the reply did not finish')
  await page.getByText('END-OF-REPLY').first().waitFor()
  const ipc = await app.evaluate(() => globalThis.__chatIpc)
  record('chat.mainDelayP99', main.p99, 'ms', { goal: 50 })
  record('chat.windowLongestTask', win.longest, 'ms', { goal: 50 })
  record('chat.windowBlocked', win.blocked, 'ms')
  record('chat.windowFps', win.fps, 'fps', { goal: 50, higherIsBetter: true })
  // 1 = each character crosses to the window once. Re-sending the whole reply on each update makes it grow with length.
  record('chat.sentPerCharacter', ipc.chars / text.length, 'x', { goal: 3 })
  recordWork('chat', work)
})

await test('a reply shows every line once and in order while it streams (ADR 0068)', async () => {
  // The window builds a streaming reply from the text added each time: what is on screen mid-reply
  // must be exactly what was printed so far.
  const lines = 24
  // Its own line mark: the page also shows the reply before it, numbered with L.
  chatCli.configure({ lines, everyMs: 120, end: 'END-OF-SECOND', mark: 'S' })
  // This reply is what follows its own question on the page.
  const shown = async () => {
    const all = await page.evaluate(() => document.body.innerText)
    return { numbers: [...all.matchAll(/^S(\d+) /gm)].map((m) => Number(m[1])), done: all.includes('END-OF-SECOND'), asked: all.includes('second-question') }
  }
  await value('chat.send', { chatId: chatAgent.id, text: 'second-question' })
  let checked = 0
  const started = Date.now()
  for (;;) {
    const { numbers, done } = await shown()
    if (Date.now() - started > 30_000) {
      const chat = await value('chat.get', { chatId: chatAgent.id })
      const last = chat.messages.at(-1)
      throw new Error(`the reply did not finish on screen in 30 s: ${numbers.length} lines shown; main has ${chat.messages.length} messages, last ${last.role} streaming=${last.streaming} error=${last.error} length=${last.parts.map((p) => p.text ?? '').join('').length}`)
    }
    // Line 1 is a code block: the numbered lines start at 2 and never skip or repeat.
    numbers.forEach((n, i) => expect(n === i + 2, `on screen mid-reply: lines ${numbers.join(', ')}`))
    if (numbers.length && !done) checked++
    if (done) {
      expect(numbers.length === lines - 1, `the finished reply shows ${numbers.length} numbered lines, not ${lines - 1}`)
      // The question belongs on screen above its reply.
      expect((await shown()).asked, 'the question is not on screen')
      break
    }
    await page.waitForTimeout(200)
  }
  expect(checked >= 3, `the reply was only seen ${checked} times while it streamed`)
})

if (process.env.HIVEORY_PERF_SOAK) {
  // Left idle after the runs above, reading the page as the check above does: does the window's memory hold?
  await test(`soak: ${process.env.HIVEORY_PERF_SOAK} s idle`, async () => {
    const until = Date.now() + Number(process.env.HIVEORY_PERF_SOAK) * 1000
    let next = 0
    while (Date.now() < until) {
      await page.evaluate(() => document.body.innerText)
      await page.waitForTimeout(200)
      if (Date.now() > next) {
        next = Date.now() + 20_000
        const mb = await megabytes()
        console.log(`      soak ${Math.round((Date.now() - until) / 1000 + Number(process.env.HIVEORY_PERF_SOAK))} s: window ${Math.round(mb.window)} MB, main ${Math.round(mb.main)} MB, gpu ${Math.round(mb.gpu)} MB`)
      }
    }
  })
}

await test('memory: eight agents after the runs above', async () => {
  const mb = await megabytes()
  record('memory.loaded.total', mb.total, 'MB')
  record('memory.loaded.main', mb.main, 'MB')
  record('memory.loaded.window', mb.window, 'MB')
  record('memory.loaded.gpu', mb.gpu, 'MB')
  record('memory.loaded.terminalHost', mb.host, 'MB')
})

// ── Against the baseline ────────────────────────────────────────────────────────────────────

await test('no number is worse than the recorded baseline allows', async () => {
  mkdirSync(shots, { recursive: true })
  writeFileSync(join(shots, 'perf.json'), JSON.stringify({ platform: process.platform, metrics }, null, 2))
  if (mode === 'record') {
    const values = Object.fromEntries(Object.entries(metrics).filter(([, m]) => m.compare !== false).map(([name, m]) => [name, m.value]))
    writeFileSync(baselineFile, `${JSON.stringify({ platform: process.platform, recordedOn: new Date().toISOString().slice(0, 10), values }, null, 2)}\n`)
    return console.log(`      baseline recorded: ${baselineFile}`)
  }
  const baseline = existsSync(baselineFile) ? JSON.parse(readFileSync(baselineFile, 'utf8')) : null
  if (mode === 'report' || !baseline || baseline.platform !== process.platform) {
    return console.log(`      not compared (${mode === 'report' ? 'report only' : baseline ? `the baseline is from ${baseline.platform}` : 'no baseline recorded'})`)
  }
  // A number passes at its goal, or when it is not half again worse than the baseline; small numbers
  // get a fixed allowance, since they jitter.
  const allowance = { ms: 30, MB: 60, fps: 8, x: 0.5, '% of a core': 10, '% of its thread': 10 }
  const worse = []
  for (const [name, m] of Object.entries(metrics)) {
    const was = baseline.values[name]
    if (was === undefined || m.compare === false) continue
    // A number at its goal is fine wherever the baseline was (frame rates follow the display, say).
    if (m.goal !== undefined && (m.higherIsBetter ? m.value >= m.goal : m.value <= m.goal)) continue
    const slack = allowance[m.unit] ?? 0
    const limit = m.higherIsBetter ? Math.min(was / 1.5, was - slack) : Math.max(was * 1.5, was + slack)
    if (m.higherIsBetter ? m.value < limit : m.value > limit) worse.push(`${name}: ${m.value} ${m.unit} (baseline ${was}, limit ${round(limit)})`)
  }
  expect(!worse.length, `slower than the baseline allows — ${worse.join('; ')}`)
})

await stopTerminalHost()
finish()
