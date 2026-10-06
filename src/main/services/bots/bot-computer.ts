import type { Bot, BotComputerStatus } from '@shared/domain/bot'
import { fail } from '@shared/errors'
import type { Logger } from '../../app/logger'
import { ToolError } from '../agent-tools/tool-args'
import type { HostKit } from '../hosts/host-kit'
import type { KitSource } from '../workspaces/workspace-service'
import { COMPUTER_DOCKERFILE, COMPUTER_IMAGE, DISPLAY, MANAGED_LABEL, NOVNC_PORT } from './computer-image'

/** A desktop belongs to one conversation at a time; an idle holder lets go after this. */
const LEASE_MS = 10 * 60_000
const RUN_TIMEOUT_MS = 120_000
const MAX_RUN_TIMEOUT_MS = 600_000
const MAX_OUTPUT = 20_000
/** The first image build downloads a desktop and Chromium; it can take minutes. */
const BUILD_TIMEOUT_MS = 20 * 60_000

type Exec = { code: number | null; stdout: string; stderr: string }

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

  constructor(
    private readonly bot: (botId: string) => Bot,
    private readonly kits: KitSource,
    /** The folder shared with a local computer at /workspace (the bot's own folder). */
    private readonly home: (botId: string) => string,
    private readonly log: Logger
  ) {}

  private async kitFor(bot: Bot): Promise<HostKit> {
    if (!bot.computer) fail('INVALID_INPUT', `${bot.name} has no computer.`, { hint: 'Give it one in its settings: Computer › Docker.' })
    return this.kits.kit(bot.computer!.host)
  }

  private async docker(kit: HostKit, args: string[], options: { stdin?: string; timeoutMs?: number } = {}): Promise<Exec> {
    const result = await kit.exec({ file: 'docker', args, timeoutMs: options.timeoutMs ?? 60_000, stdin: options.stdin })
    if (result.code === null && /ENOENT|not found|not recognized/i.test(result.stderr)) {
      fail('NOT_FOUND', `Docker is not installed${kit.remote ? ` on ${kit.label}` : ''}.`, { hint: 'Install Docker (Docker Desktop on Windows and macOS), then try again.' })
    }
    return result
  }

  /** What the bot's computer is doing right now. */
  async status(botId: string): Promise<BotComputerStatus> {
    const bot = this.bot(botId)
    if (!bot.computer) return { state: 'off' }
    try {
      const kit = await this.kitFor(bot)
      const daemon = await this.docker(kit, ['version', '--format', '{{.Server.Version}}'])
      if (daemon.code !== 0) return { state: 'unavailable', detail: `Docker is not running${kit.remote ? ` on ${kit.label}` : ''}.` }
      const inspect = await this.docker(kit, ['inspect', '--format', `{{.State.Running}} {{index .Config.Labels "${MANAGED_LABEL}"}}`, containerName(botId)])
      if (inspect.code !== 0) return { state: 'missing', detail: 'Starts on first use.' }
      const [running, owner] = inspect.stdout.trim().split(' ')
      if (owner !== botId) return { state: 'unavailable', detail: `A container named ${containerName(botId)} exists but is not this bot's; Hiveory leaves it alone.` }
      return running === 'true' ? { state: 'running', url: this.tunnels.has(botId) ? this.urlOf(this.tunnels.get(botId)!.port) : undefined } : { state: 'stopped' }
    } catch (error) {
      return { state: 'unavailable', detail: error instanceof Error ? error.message : String(error) }
    }
  }

  /** Builds the image if needed, creates the container if missing, starts it, and waits for the desktop. */
  ensure(botId: string): Promise<void> {
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
    if ((await this.docker(kit, ['version', '--format', '{{.Server.Version}}'])).code !== 0) {
      fail('NOT_FOUND', `Docker is not running${kit.remote ? ` on ${kit.label}` : ''}.`, { hint: 'Start Docker, then try again.' })
    }
    if ((await this.docker(kit, ['image', 'inspect', COMPUTER_IMAGE])).code !== 0) {
      this.log.info(`Building ${COMPUTER_IMAGE}${kit.remote ? ` on ${kit.label}` : ''}`)
      const built = await this.docker(kit, ['build', '-t', COMPUTER_IMAGE, '-'], { stdin: COMPUTER_DOCKERFILE, timeoutMs: BUILD_TIMEOUT_MS })
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

  async stop(botId: string): Promise<void> {
    const kit = await this.kitFor(this.bot(botId))
    this.closeTunnel(botId)
    await this.docker(kit, ['stop', '-t', '5', containerName(botId)])
  }

  /** A loopback URL to watch and drive the desktop in a browser (noVNC). */
  async takeControl(botId: string): Promise<string> {
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
  claim(botId: string, threadId: string, threadTitle: (id: string) => string | undefined): void {
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
    const kit = await this.kitFor(this.bot(botId))
    await this.docker(kit, ['exec', '-d', '-e', `DISPLAY=${DISPLAY}`, containerName(botId), 'chromium', '--no-sandbox', '--no-first-run', '--disable-dev-shm-usage', '--user-data-dir=/home/bot/.chromium', url])
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

  private async exec(botId: string, command: string[], timeoutMs: number, options: string[] = []): Promise<Exec> {
    await this.ensure(botId)
    const kit = await this.kitFor(this.bot(botId))
    return this.docker(kit, ['exec', '-e', `DISPLAY=${DISPLAY}`, ...options, containerName(botId), ...command], { timeoutMs })
  }

  private urlOf(port: number): string {
    return `http://127.0.0.1:${port}/vnc.html?autoconnect=1&resize=scale`
  }

  private closeTunnel(botId: string): void {
    this.tunnels.get(botId)?.close()
    this.tunnels.delete(botId)
  }
}
