// The phone app's end-to-end tests: Maestro drives Hiveory in Expo Go on a real Android phone (adb),
// against a throwaway Hiveory server with a stand-in agent, so no real agent, workspace or setting
// is touched. Usage (from the repo root):
//   pnpm build                 the desktop server the tests start
//   pnpm mobile start          Metro, which Expo Go loads the app from
//   pnpm mobile e2e [flow]     every flow in e2e/flows, or the ones whose file name contains [flow]
//   pnpm mobile e2e --serve-only   only the seeded test server, to try the app by hand (Ctrl+C stops it)
// Tools: adb (Android SDK platform-tools), Java 17 and Maestro. Defaults are the folders in
// %LOCALAPPDATA%\hiveory-e2e (JAVA_HOME, MAESTRO) and %LOCALAPPDATA%\Android\Sdk (ADB); env overrides them.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const serveOnly = process.argv.includes('--serve-only')
const only = process.argv.slice(2).find((a) => !a.startsWith('--'))
const PORT = 7790
const local = process.env.LOCALAPPDATA ?? ''
const tools = join(local, 'hiveory-e2e')
const ADB = process.env.ADB ?? join(local, 'Android', 'Sdk', 'platform-tools', 'adb.exe')
const MAESTRO = process.env.MAESTRO ?? join(tools, 'maestro', 'bin', process.platform === 'win32' ? 'maestro.bat' : 'maestro')
const JAVA_HOME =
  process.env.JAVA_HOME ??
  (existsSync(join(tools, 'jdk')) ? join(tools, 'jdk', readdirSync(join(tools, 'jdk')).find((d) => d.startsWith('jdk')) ?? '') : '')

const fail = (message) => {
  console.error(`✗ ${message}`)
  process.exit(1)
}
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim()

// ---------- preflight ----------
if (!serveOnly)
  for (const [name, path] of [
    ['adb', ADB],
    ['Maestro', MAESTRO]
  ])
    if (!existsSync(path)) fail(`${name} not found at ${path}.`)
const devices = serveOnly ? [] : run(ADB, ['devices']).split(/\r?\n/).slice(1).filter((l) => /\tdevice$/.test(l))
if (!serveOnly && devices.length !== 1) fail(`Connect exactly one Android phone over adb (found ${devices.length}). See mobile/README.md › End-to-end tests.`)
if (!existsSync(join(root, 'out', 'main'))) fail('Build the desktop first: pnpm build')
const metro = await fetch('http://127.0.0.1:8081/status').then((r) => r.text(), () => '')
if (!serveOnly && !metro.includes('running')) fail('Start Metro first: pnpm mobile start')
const tailscaleIp = (() => {
  try {
    return run('tailscale', ['ip', '-4']).split(/\r?\n/)[0]
  } catch {
    return run(join('C:', 'Program Files', 'Tailscale', 'tailscale.exe'), ['ip', '-4']).split(/\r?\n/)[0]
  }
})()
if (!/^100\./.test(tailscaleIp)) fail('Tailscale must be on (the phone reaches the test server over it).')

// ---------- a throwaway world ----------
const sandbox = mkdtempSync(join(tmpdir(), 'hiveory-phone-e2e-'))
const git = (cwd, ...args) => run('git', args, { cwd })
const repo = join(sandbox, 'demo-app')
mkdirSync(repo)
git(repo, 'init', '-b', 'main')
git(repo, 'config', 'user.email', 'e2e@example.test')
git(repo, 'config', 'user.name', 'e2e')
writeFileSync(join(repo, 'README.md'), '# demo\n')
git(repo, 'add', '.')
git(repo, 'commit', '-m', 'init')
// The stand-in answers to the Aider adapter (no hooks, no MCP), and is the only CLI on this PATH.
const bin = join(sandbox, 'bin')
mkdirSync(bin)
writeFileSync(join(bin, 'aider.cmd'), `@node "${join(here, 'standin-agent.mjs')}" %*\r\n`)
const gitDir = dirname(run('where', ['git']).split(/\r?\n/)[0])
const PATH = [bin, dirname(process.execPath), gitDir, join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')].join(';')

const electron = join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron')
const server = spawn(electron, ['.', '--serve', String(PORT), '--tailscale'], {
  cwd: root,
  env: { ...process.env, PATH, HIVEORY_USER_DATA: join(sandbox, 'profile'), LOCALAPPDATA: join(sandbox, 'local'), HIVEORY_NO_RELAUNCH: '1' }
})
let output = ''
const codes = []
server.stdout.on('data', (chunk) => {
  output += chunk
  for (const m of String(chunk).matchAll(/Pairing code: (\S+)/g)) codes.push(m[1])
})
server.stderr.on('data', (chunk) => (output += chunk))
const stop = () => {
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' })
    else server.kill()
  } catch {
    // Already gone.
  }
  rmSync(sandbox, { recursive: true, force: true, maxRetries: 5 })
}
process.on('exit', stop)
process.on('SIGINT', () => process.exit(130))

const waitFor = async (test, what, ms = 60_000) => {
  const until = Date.now() + ms
  while (Date.now() < until) {
    const value = test()
    if (value) return value
    await new Promise((r) => setTimeout(r, 250))
  }
  fail(`Timed out waiting for ${what}.\n${output.slice(-2000)}`)
}
await waitFor(() => output.includes('Hiveory server ready'), 'the test server')
const firstCode = await waitFor(() => codes[0], 'its pairing code')

// ---------- seed it as a desktop client: one workspace with a waiting stand-in agent ----------
const base = `http://127.0.0.1:${PORT}`
const { token } = await (await fetch(`${base}/pair`, { method: 'POST', body: JSON.stringify({ code: firstCode, name: 'e2e seeder', client: 'desktop' }) })).json()
if (!token) fail('The seeder could not pair with the test server.')
const call = async (channel, payload) => {
  const res = await (await fetch(`${base}/call`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ channel, payload }) })).json()
  if (!res.ok) fail(`${channel} failed: ${JSON.stringify(res.error ?? res)}`)
  return res.value
}
const project = await call('projects.add', { mode: 'folder', path: repo })
const primary = await call('workspaces.create', { projectId: project.id, kind: 'main', name: 'Primary', cliSelections: [], autoApprove: false })
await call('agents.open', { workspaceId: primary.id, cliId: 'aider' })
const phoneCode = await waitFor(() => codes[1], 'a fresh pairing code for the phone')

if (serveOnly) {
  console.log(`Test server ready: ${tailscaleIp}:${PORT} and 127.0.0.1:${PORT} · phone pairing code ${phoneCode} · Ctrl+C stops it`)
  await new Promise(() => undefined)
}

// ---------- run the flows on the phone ----------
const flows = join(here, 'flows')
const selected = readdirSync(flows)
  .filter((f) => f.endsWith('.yaml') && (!only || f.includes(only)))
  .sort()
const env = { ADDRESS: tailscaleIp, PORT: String(PORT), CODE: phoneCode, METRO: `exp://${tailscaleIp}:8081`, PROJECT: 'demo-app' }
console.log(`Test server ${tailscaleIp}:${PORT} · ${selected.length} flows on ${devices[0].split('\t')[0]}`)
// One suite, so the flows run in order and share the app's state (pairing first, forgetting last).
const suite = join(sandbox, 'suite.yaml')
writeFileSync(suite, `appId: host.exp.exponent\n---\n${selected.map((f) => `- runFlow: ${JSON.stringify(join(flows, f))}`).join('\n')}\n`)
const code = await new Promise((done) =>
  spawn(MAESTRO, ['test', ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]), suite], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, JAVA_HOME, ANDROID_HOME: join(local, 'Android', 'Sdk'), PATH: `${dirname(ADB)};${process.env.PATH}` }
  }).on('exit', (c) => done(c ?? 1))
)
if (code !== 0) fail('A flow failed (Maestro printed which step, and saved screenshots under ~/.maestro/tests).')

// ---------- what the phone did, checked on the computer ----------
if (!only) {
  const screen = async (instanceId) => (await call('terminal.snapshot', { instanceId })).data.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
  const worktrees = await call('workspaces.list', { projectId: project.id })
  const [first] = await call('agents.list', { workspaceId: primary.id })
  const checks = [
    ['the answer reached the agent', (await screen(first.id)).includes('Applied: y')],
    ['the message reached the agent', (await screen(first.id)).includes('Got: hello from phone')],
    ['a worktree was created', worktrees.some((w) => w.kind === 'isolated')],
    ['an agent was opened in it', (await Promise.all(worktrees.filter((w) => w.kind === 'isolated').map((w) => call('agents.list', { workspaceId: w.id })))).some((a) => a.length > 0)]
  ]
  for (const [what, ok] of checks) console.log(`${ok ? '✓' : '✗'} ${what}`)
  if (checks.some(([, ok]) => !ok)) fail('The phone showed success, but the computer disagrees.')
}
console.log('✓ All phone flows passed.')
process.exit(0)
