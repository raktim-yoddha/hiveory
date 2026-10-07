import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Bot, BotComputerStatus } from '@shared/domain/bot'
import { fail } from '@shared/errors'
import type { Logger } from '../../app/logger'
import { ToolError } from '../agent-tools/tool-args'
import type { HostKit } from '../hosts/host-kit'
import type { KitSource } from '../workspaces/workspace-service'
import { COMPUTER_DOCKERFILE, COMPUTER_IMAGE, COMPUTER_IMAGE_VERSION, DBUS_ENV_FILE, DISPLAY, IMAGE_LABEL, MANAGED_LABEL, NOVNC_PORT } from './computer-image'

/** A desktop belongs to one conversation at a time; an idle holder lets go after this. */
const LEASE_MS = 10 * 60_000
const RUN_TIMEOUT_MS = 120_000
const MAX_RUN_TIMEOUT_MS = 600_000
const MAX_OUTPUT = 20_000
/** The first image build downloads a desktop and Chromium; it can take minutes. */
const BUILD_TIMEOUT_MS = 20 * 60_000

type Exec = { code: number | null; stdout: string; stderr: string }
type Engine = 'docker' | 'podman'

/** How each engine says its daemon (or Podman's machine) answers. */
const ENGINE_CHECK: Record<Engine, string[]> = {
  docker: ['version', '--format', '{{.Server.Version}}'],
  podman: ['info', '--format', '{{.Version.Version}}']
}
const missing = (r: Exec): boolean => r.code === null && /ENOENT|not found|not recognized/i.test(r.stderr)

/** Docker container names: stable per bot, independent of its display name. */
export const containerName = (botId: string): string => `hiveory-computer-${botId.replace(/[^A-Za-z0-9]/g, '').slice(0, 16)}`

/**
 * Each bot's own Linux computer (ADR 0022): a hardened Docker container from
 * Hiveory's desktop image, on this computer or on an SSH host (Docker there is
 * driven through hiveoryd). It is created on first use and never deleted on its
 * own. Bots drive it with desktop_* tools — every one a `docker exec` with an
 * argument list — and the user can take control through noVNC on a loopback port.
 * One conversation holds a desktop at a time.
 */
export class BotComputers {
  private readonly leases = new Map<string, { threadId: string; until: number }>()
  private readonly tunnels = new Map<string, { port: number; close(): void }>()
  private readonly preparing = new Map<string, Promise<void>>()
  /** The container engine found on each machine (by kit label), found once per session. */
  private readonly engines = new Map<string, Engine>()

  constructor(
    private readonly bot: (botId: string) => Bot,
    private readonly kits: KitSource,
    /** The folder shared with a local computer at /workspace (the bot's own folder). */
    private readonly home: (botId: string) => string,
    private readonly log: Logger
  ) {}

  /** The bot whose computer this is: the bot itself, or the one it shares a seat on (ADR 0032). */
  private owner(botId: string): Bot {
    const bot = this.bot(botId)
    if (bot.computer?.kind !== 'shared') return bot
    const owner = this.bot(bot.computer.botId)
    if (owner.computer?.kind !== 'docker') fail('INVALID_INPUT', `${owner.name} has no computer of its own to share.`, { hint: `Give ${owner.name} a Linux computer, or choose another for ${bot.name}.` })
    return owner
  }

  private async kitFor(bot: Bot): Promise<HostKit> {
    if (bot.computer?.kind !== 'docker') fail('INVALID_INPUT', `${bot.name} has no computer.`, { hint: "Choose where its Linux computer runs in the bot's panel: Computer › Works on." })
    return this.kits.kit(bot.computer!.kind === 'docker' ? bot.computer!.host : undefined)
  }

  /** Docker, else Podman: whichever answers on that machine. Fails with what to do when neither does. */
  private async engineOf(kit: HostKit): Promise<Engine> {
    const known = this.engines.get(kit.label)
    if (known) return known
    const where = kit.remote ? ` on ${kit.label}` : ''
    const installed: Engine[] = []
    for (const engine of ['docker', 'podman'] as const) {
      const r = await kit.exec({ file: engine, args: ENGINE_CHECK[engine], timeoutMs: 30_000 })
      if (r.code === 0) {
        this.engines.set(kit.label, engine)
        return engine
      }
      if (!missing(r)) installed.push(engine)
    }
    if (installed[0] === 'podman') fail('NOT_FOUND', `Podman is not running${where}.`, { hint: 'Start it (podman machine start on Windows and macOS), then try again.' })
    if (installed.length) fail('NOT_FOUND', `Docker is not running${where}.`, { hint: 'Start Docker, then try again.' })
    return fail('NOT_FOUND', `Neither Docker nor Podman is installed${where}.`, { hint: 'Install Docker (Docker Desktop on Windows and macOS) or Podman, then try again.' })
  }

  /** Runs the engine's CLI (same arguments for Docker and Podman). */
  private async docker(kit: HostKit, args: string[], options: { stdin?: string; timeoutMs?: number } = {}): Promise<Exec> {
    const engine = await this.engineOf(kit)
    return kit.exec({ file: engine, args, timeoutMs: options.timeoutMs ?? 60_000, stdin: options.stdin })
  }

  /** Builds the image from the embedded file: Docker reads it from stdin with no context; Podman needs an empty context folder. */
  private async build(kit: HostKit): Promise<Exec> {
    if ((await this.engineOf(kit)) === 'docker') return this.docker(kit, ['build', '-t', COMPUTER_IMAGE, '-'], { stdin: COMPUTER_DOCKERFILE, timeoutMs: BUILD_TIMEOUT_MS })
    if (kit.remote) {
      const script = 'd=$(mktemp -d) && podman build -t "$1" -f - "$d"; r=$?; rmdir "$d"; exit $r'
      return kit.exec({ file: 'sh', args: ['-c', script, 'sh', COMPUTER_IMAGE], stdin: COMPUTER_DOCKERFILE, timeoutMs: BUILD_TIMEOUT_MS })
    }
    const context = mkdtempSync(join(tmpdir(), 'hiveory-image-'))
    try {
      return await this.docker(kit, ['build', '-t', COMPUTER_IMAGE, '-f', '-', context], { stdin: COMPUTER_DOCKERFILE, timeoutMs: BUILD_TIMEOUT_MS })
    } finally {
      rmSync(context, { recursive: true, force: true })
    }
  }

  /** What the bot's computer is doing right now. */
  async status(botId: string): Promise<BotComputerStatus> {
    if (!this.bot(botId).computer) return { state: 'off' }
    try {
      const bot = this.owner(botId)
      const shared = bot.id !== botId ? { sharedFrom: bot.id } : {}
      const kit = await this.kitFor(bot)
      const engine = await this.engineOf(kit)
      const inspect = await this.docker(kit, ['inspect', '--format', `{{.State.Running}} {{index .Config.Labels "${MANAGED_LABEL}"}} {{index .Config.Labels "${IMAGE_LABEL}"}}`, containerName(bot.id)])
      if (inspect.code !== 0) return { state: 'missing', detail: 'Starts on first use.', engine, ...shared }
      const [running, owner, version] = inspect.stdout.trim().split(' ')
      if (owner !== bot.id) return { state: 'unavailable', detail: `A container named ${containerName(bot.id)} exists but is not this bot's; Hiveory leaves it alone.`, engine }
      const outdated = version !== String(COMPUTER_IMAGE_VERSION) ? { outdated: true } : {}
      return running === 'true'
        ? { state: 'running', url: this.tunnels.has(bot.id) ? this.urlOf(this.tunnels.get(bot.id)!.port) : undefined, engine, ...outdated, ...shared }
        : { state: 'stopped', engine, ...outdated, ...shared }
    } catch (error) {
      return { state: 'unavailable', detail: error instanceof Error ? error.message : String(error) }
    }
  }

  /** Makes the computer again from the current image (ADR 0032): /workspace stays, everything else is new. */
  async rebuild(botId: string): Promise<void> {
    const bot = this.owner(botId)
    const kit = await this.kitFor(bot)
    const name = containerName(bot.id)
    const inspect = await this.docker(kit, ['inspect', '--format', `{{index .Config.Labels "${MANAGED_LABEL}"}}`, name])
    if (inspect.code === 0) {
      if (inspect.stdout.trim() !== bot.id) fail('FORBIDDEN', `A container named ${name} exists but is not this bot's.`, { hint: 'Remove or rename it, then try again.' })
      this.closeTunnel(bot.id)
      const removed = await this.docker(kit, ['rm', '-f', name], { timeoutMs: 120_000 })
      if (removed.code !== 0) fail('UNEXPECTED', 'Could not remove the old computer.', { detail: removed.stderr })
    }
    await this.ensure(bot.id)
  }

  /** Builds the image if needed, creates the container if missing, starts it, and waits for the desktop. */
  ensure(seatId: string): Promise<void> {
    const botId = this.owner(seatId).id
    const running = this.preparing.get(botId)
    if (running) return running
    const work = this.prepare(botId).finally(() => this.preparing.delete(botId))
    this.preparing.set(botId, work)
    return work
  }

  private async prepare(botId: string): Promise<void> {
    const bot = this.bot(botId)
    const kit = await this.kitFor(bot)
    const name = containerName(botId)
    if ((await this.docker(kit, ['image', 'inspect', COMPUTER_IMAGE])).code !== 0) {
      this.log.info(`Building ${COMPUTER_IMAGE}${kit.remote ? ` on ${kit.label}` : ''}`)
      const built = await this.build(kit)
      if (built.code !== 0) fail('UNEXPECTED', 'Could not build the bot computer image.', { detail: built.stderr.slice(-4000) })
    }
    const inspect = await this.docker(kit, ['inspect', '--format', `{{.State.Running}} {{index .Config.Labels "${MANAGED_LABEL}"}}`, name])
    if (inspect.code === 0) {
      const [running, owner] = inspect.stdout.trim().split(' ')
      if (owner !== botId) fail('FORBIDDEN', `A container named ${name} exists but is not this bot's.`, { hint: 'Remove or rename it, then try again.' })
      if (running !== 'true') {
        const started = await this.docker(kit, ['start', name])
        if (started.code !== 0) fail('UNEXPECTED', 'Could not start the bot computer.', { detail: started.stderr })
      }
    } else {
      // Hardened: no capabilities, no privilege escalation, bounded resources. The desktop's only door
      // is noVNC on this computer's loopback (or through the SSH tunnel for a remote machine).
      const created = await this.docker(kit, [
        'run', '-d', '--name', name,
        '--label', `${MANAGED_LABEL}=${botId}`,
        '--hostname', 'bot-computer',
        '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
        '--pids-limit', '512', '--memory', '4g', '--cpus', '2', '--shm-size', '512m',
        '--restart', 'unless-stopped',
        ...(kit.remote ? ['-v', `${name}:/workspace`] : ['-p', `127.0.0.1::${NOVNC_PORT}`, '-v', `${this.home(botId)}:/workspace`]),
        COMPUTER_IMAGE
      ], { timeoutMs: 120_000 })
      if (created.code !== 0) fail('UNEXPECTED', 'Could not create the bot computer.', { detail: created.stderr.slice(-4000) })
    }
    // Ready = the X display answers and noVNC listens (so "take control" works right away).
    const listening = `grep -qi ':${NOVNC_PORT.toString(16).toUpperCase().padStart(4, '0')} 00000000:0000 0A' /proc/net/tcp`
    for (let i = 0; i < 60; i++) {
      const ready = await this.docker(kit, ['exec', '-e', `DISPLAY=${DISPLAY}`, name, 'sh', '-c', `xdpyinfo >/dev/null 2>&1 && ${listening}`])
      if (ready.code === 0) return
      await new Promise((r) => setTimeout(r, 250))
    }
    fail('UNEXPECTED', 'The bot computer started but its desktop did not come up.')
  }

  async stop(seatId: string): Promise<void> {
    const bot = this.owner(seatId)
    const kit = await this.kitFor(bot)
    this.closeTunnel(bot.id)
    await this.docker(kit, ['stop', '-t', '5', containerName(bot.id)])
  }

  /** A loopback URL to watch and drive the desktop in a browser (noVNC). */
  async takeControl(seatId: string): Promise<string> {
    const botId = this.owner(seatId).id
    await this.ensure(botId)
    const kit = await this.kitFor(this.bot(botId))
    const name = containerName(botId)
    if (!kit.remote) {
      const mapped = await this.docker(kit, ['port', name, `${NOVNC_PORT}/tcp`])
      const port = /:(\d+)\s*$/m.exec(mapped.stdout.trim().split(/\r?\n/)[0] ?? '')?.[1]
      if (!port) fail('UNEXPECTED', 'The desktop port is not published.')
      return this.urlOf(Number(port))
    }
    const existing = this.tunnels.get(botId)
    if (existing) return this.urlOf(existing.port)
    const ip = (await this.docker(kit, ['inspect', '--format', '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}', name])).stdout.trim().split(' ')[0]
    if (!ip) fail('UNEXPECTED', 'Could not find the bot computer on its network.')
    const tunnel = await kit.forward(ip!, NOVNC_PORT)
    this.tunnels.set(botId, tunnel)
    return this.urlOf(tunnel.port)
  }

  closeAll(): void {
    for (const id of [...this.tunnels.keys()]) this.closeTunnel(id)
  }

  /** The desktop is this conversation's until it finishes (or idles past the lease); others wait. */
  claim(seatId: string, threadId: string, threadTitle: (id: string) => string | undefined): void {
    // A shared computer is one desktop: its lease spans every bot with a seat on it.
    const botId = this.owner(seatId).id
    const now = Date.now()
    const lease = this.leases.get(botId)
    if (lease && lease.threadId !== threadId && lease.until > now) {
      throw new ToolError(`Your computer is in use by another conversation ("${threadTitle(lease.threadId) ?? 'another thread'}"). Wait for it to finish, or carry on without the desktop.`)
    }
    this.leases.set(botId, { threadId, until: now + LEASE_MS })
  }

  release(threadId: string): void {
    for (const [botId, lease] of this.leases) if (lease.threadId === threadId) this.leases.delete(botId)
  }

  // ── Desktop actions: each one a docker exec with an argument list (no shell on this computer). ──

  async screenshot(botId: string): Promise<string> {
    const r = await this.exec(botId, ['sh', '-c', `import -display ${DISPLAY} -window root png:- | base64 -w0`], 30_000)
    if (r.code !== 0 || !r.stdout) throw new ToolError(`Screenshot failed: ${r.stderr.trim() || 'no image'}`)
    return r.stdout.trim()
  }

  async click(botId: string, x: number, y: number, button: 'left' | 'right' | 'middle', double: boolean): Promise<void> {
    const code = { left: '1', middle: '2', right: '3' }[button]
    await this.xdotool(botId, ['mousemove', '--sync', String(Math.round(x)), String(Math.round(y)), 'click', '--repeat', double ? '2' : '1', code])
  }

  async type(botId: string, text: string): Promise<void> {
    await this.xdotool(botId, ['type', '--delay', '8', '--', text])
  }

  async key(botId: string, keys: string): Promise<void> {
    const list = keys.split(/\s+/).filter(Boolean)
    if (!list.length || list.some((k) => !/^[A-Za-z0-9_+-]+$/.test(k))) throw new ToolError('Keys look like "ctrl+l", "Return" or "ctrl+shift+t"; separate several with spaces.')
    await this.xdotool(botId, ['key', '--', ...list])
  }

  async scroll(botId: string, direction: 'up' | 'down', amount: number): Promise<void> {
    await this.xdotool(botId, ['click', '--repeat', String(Math.min(20, Math.max(1, Math.round(amount)))), direction === 'up' ? '4' : '5'])
  }

  async openUrl(botId: string, url: string): Promise<void> {
    if (!/^https?:\/\//i.test(url)) throw new ToolError('Only http and https addresses open in the browser.')
    await this.ensure(botId)
    const kit = await this.kitFor(this.owner(botId))
    // On the session bus with accessibility on, so desktop_ui can read its pages. The URL is an argument, never shell text.
    await this.docker(kit, [
      'exec', '-d', '-e', `DISPLAY=${DISPLAY}`, containerName(this.owner(botId).id),
      'sh', '-c', `. ${DBUS_ENV_FILE} 2>/dev/null; exec chromium "$@"`, 'sh',
      '--no-sandbox', '--no-first-run', '--disable-dev-shm-usage', '--force-renderer-accessibility', '--user-data-dir=/home/bot/.chromium', url
    ])
  }

  /** The screen as UI elements from the accessibility tree: role, name and centre point, indented by depth. */
  async uiTree(botId: string): Promise<string> {
    const r = await this.exec(botId, ['sh', '-c', `. ${DBUS_ENV_FILE} 2>/dev/null; exec hiveory-ui-tree`], 30_000)
    if (r.code === 127 || /not found/i.test(r.stderr)) {
      throw new ToolError("Your computer runs an older image that can't read the screen as UI elements. Ask the user to rebuild it (Computer tab › Rebuild), and use desktop_screenshot meanwhile.")
    }
    if (r.code !== 0) throw new ToolError(`Could not read the screen's UI: ${r.stderr.trim() || r.stdout.trim() || `exit ${r.code}`}`)
    return r.stdout.trim()
  }

  /** Runs a shell command inside the bot's own container (its sandbox), in /workspace. */
  async run(botId: string, command: string, timeoutMs = RUN_TIMEOUT_MS): Promise<{ code: number | null; output: string }> {
    const r = await this.exec(botId, ['bash', '-lc', command], Math.min(MAX_RUN_TIMEOUT_MS, timeoutMs), ['-w', '/workspace'])
    const output = `${r.stdout}${r.stderr ? `\n${r.stderr}` : ''}`.trim()
    return { code: r.code, output: output.length > MAX_OUTPUT ? `…${output.slice(-MAX_OUTPUT)}` : output }
  }

  private async xdotool(botId: string, args: string[]): Promise<void> {
    const r = await this.exec(botId, ['xdotool', ...args], 30_000)
    if (r.code !== 0) throw new ToolError(`Desktop action failed: ${r.stderr.trim() || `exit ${r.code}`}`)
  }

  private async exec(seatId: string, command: string[], timeoutMs: number, options: string[] = []): Promise<Exec> {
    const bot = this.owner(seatId)
    await this.ensure(bot.id)
    const kit = await this.kitFor(bot)
    return this.docker(kit, ['exec', '-e', `DISPLAY=${DISPLAY}`, ...options, containerName(bot.id), ...command], { timeoutMs })
  }

  private urlOf(port: number): string {
    return `http://127.0.0.1:${port}/vnc.html?autoconnect=1&resize=scale`
  }

  private closeTunnel(botId: string): void {
    this.tunnels.get(botId)?.close()
    this.tunnels.delete(botId)
  }
}
