import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import type { HookEndpoint } from '../cli/adapters/types'

/**
 * Where this computer's daemon for a protocol (ADR 0050) says how to reach it: its endpoint, pid
 * and token. One file per protocol, so a newer app still finds an older daemon to drain (§8).
 */
export const localEndpointFile = (protocol: number): string => `endpoint-${protocol}.json`

/** The protocols of the endpoint files in `names` (a folder listing), other than `current`. */
export const otherProtocols = (names: string[], current: number): number[] =>
  names
    .map((name) => /^endpoint-(\d+)\.json$/.exec(name)?.[1])
    .filter((p): p is string => p !== undefined)
    .map(Number)
    .filter((p) => p !== current)
    .sort((a, b) => a - b)

export interface LocalEndpoint {
  protocol: number
  pid: number
  /** Changes with every daemon start, so the app can tell a new daemon from the one it knew. */
  incarnation: string
  path: string
  token: string
  /** The relay agents report hooks to and reach their tools through (ADR 0050 §6). */
  relay?: HookEndpoint
  /** The executable the daemon runs from (a staged runtime copy, or the app itself). */
  exe?: string
  /** When it started (ms since the epoch). */
  since?: number
}

/**
 * The daemon's endpoint for a protocol version (named by protocol, never by build: ADR 0050 §8).
 * Windows: a named pipe, private to this user, its name derived from the profile's folder so two
 * profiles never meet. Elsewhere: a socket inside the profile's own 0700 folder.
 */
export const localEndpointPath = (dir: string, protocol: number, platform = process.platform): string =>
  platform === 'win32'
    ? `\\\\.\\pipe\\hiveoryd-${createHash('sha256').update(dir.toLowerCase()).digest('hex').slice(0, 16)}-${protocol}`
    : posix.join(dir, `hiveoryd-${protocol}.sock`)
