import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join } from 'node:path'
import type { SshHostSuggestion, TailnetStatus } from '@shared/domain/tailnet'
import type { Tailscale } from '../tailscale/tailscale'
import { isSafeDestination } from './ssh-host'

export interface SshConfigHost {
  alias: string
  hostName?: string
  user?: string
  port?: number
}

/** Include nesting limit, as OpenSSH's own. */
const MAX_DEPTH = 16

/** `*` and `?` in the file-name part only (OpenSSH also globs folders; nobody does). */
const globFiles = (pattern: string): string[] => {
  const name = basename(pattern)
  if (!/[*?]/.test(name)) return [pattern]
  const matcher = new RegExp(`^${name.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`)
  try {
    return readdirSync(dirname(pattern))
      .filter((f) => matcher.test(f))
      .sort()
      .map((f) => join(dirname(pattern), f))
  } catch {
    return []
  }
}

/**
 * The named hosts in an OpenSSH config (Orca's "OpenSSH config picker"): `Host`
 * aliases without wildcards or negations, with the HostName/User/Port that
 * apply to them (first value wins, like ssh), following `Include`.
 */
export const parseSshConfig = (text: string, readInclude: (pattern: string) => string[], depth = 0): SshConfigHost[] => {
  const hosts: SshConfigHost[] = []
  let current: SshConfigHost[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const match = /^(\S+?)(?:\s*=\s*|\s+)(.+)$/.exec(line)
    if (!match) continue
    const keyword = match[1]!.toLowerCase()
    const value = match[2]!.trim().replace(/^"(.*)"$/, '$1')
    if (keyword === 'host') {
      current = value
        .split(/\s+/)
        .filter((p) => !/[*?!]/.test(p) && isSafeDestination(p))
        .map((alias) => ({ alias }))
      hosts.push(...current)
    } else if (keyword === 'match') {
      current = []
    } else if (keyword === 'include' && depth < MAX_DEPTH) {
      for (const pattern of value.split(/\s+/)) for (const included of readInclude(pattern)) hosts.push(...parseSshConfig(included, readInclude, depth + 1))
    } else {
      for (const host of current) {
        if (keyword === 'hostname') host.hostName ??= value
        else if (keyword === 'user') host.user ??= value
        else if (keyword === 'port' && /^\d+$/.test(value)) host.port ??= Number(value)
      }
    }
  }
  // An alias named twice keeps its first block (ssh reads the first match too).
  return hosts.filter((h, i) => hosts.findIndex((o) => o.alias === h.alias) === i)
}

/** The user's ~/.ssh/config hosts; a missing or unreadable file is simply none. */
export const readSshConfigHosts = (home = homedir()): SshConfigHost[] => {
  const sshDir = join(home, '.ssh')
  const read = (file: string): string => {
    try {
      return readFileSync(file, 'utf8')
    } catch {
      return ''
    }
  }
  const readInclude = (pattern: string): string[] => {
    const expanded = pattern.startsWith('~/') ? join(home, pattern.slice(2)) : isAbsolute(pattern) ? pattern : join(sshDir, pattern)
    return globFiles(expanded).map(read)
  }
  // Automated runs point Hiveory at their own config, as the connector does (HIVEORY_SSH_CONFIG).
  return parseSshConfig(read(process.env.HIVEORY_SSH_CONFIG ?? join(sshDir, 'config')), readInclude)
}

/**
 * Everything the SSH host picker offers (ADR 0025): the user's own Tailscale
 * devices and their ~/.ssh/config hosts. A config host that points at a tailnet
 * device is shown once, as the alias (it carries the user's own settings).
 */
export const suggestHosts = async (tailscale: Tailscale, config: SshConfigHost[] = readSshConfigHosts()): Promise<{ tailscale: TailnetStatus['state']; hosts: SshHostSuggestion[] }> => {
  const tailnet = await tailscale.status()
  const fromConfig: SshHostSuggestion[] = config.map((h) => {
    const device = tailnet.devices.find((d) => [d.dnsName, d.name, d.ip].includes(h.hostName ?? h.alias))
    const where = [h.user && `${h.user}@`, h.hostName ?? '', h.port && h.port !== 22 ? `:${h.port}` : ''].filter(Boolean).join('')
    return {
      destination: h.alias,
      label: h.alias,
      detail: device ? `~/.ssh/config · Tailscale · ${device.online ? 'online' : 'offline'}` : `~/.ssh/config${where ? ` · ${where}` : ''}`,
      source: 'config',
      ...(device ? { online: device.online } : {})
    }
  })
  const covered = new Set(config.map((h) => h.hostName ?? h.alias))
  const fromTailnet: SshHostSuggestion[] = tailnet.devices
    .filter((d) => !covered.has(d.dnsName) && !covered.has(d.name) && !covered.has(d.ip))
    .map((d) => ({ destination: d.dnsName || d.name, label: d.name, detail: `Tailscale · ${[d.os, d.online ? 'online' : 'offline'].filter(Boolean).join(' · ')}`, source: 'tailnet' as const, online: d.online }))
    .filter((s) => isSafeDestination(s.destination))
  // Online devices first; the config keeps its own order.
  return { tailscale: tailnet.state, hosts: [...fromTailnet.filter((s) => s.online), ...fromConfig, ...fromTailnet.filter((s) => !s.online)] }
}
