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

/**
 * The longest socket path the system takes, in bytes: `sun_path` less its closing NUL (macOS and the
 * BSDs 104, Linux 108). A longer one cannot be listened on, and the daemon would never start.
 */
export const socketPathMax = (platform: NodeJS.Platform = process.platform): number => (platform === 'linux' ? 107 : 103)

/**
 * Where a socket goes when the profile's own folder makes its path too long (ADR 0050 amendment):
 * a folder of this user's own, named for the profile, in the per-user runtime folder on Linux
 * (`XDG_RUNTIME_DIR`), else the system's temporary folder (per user on macOS). Null when the
 * profile's folder is short enough, which keeps the socket where ADR 0050 §2 puts it.
 */
export const shortSocketDir = (
  dir: string,
  protocol: number,
  { platform = process.platform, runtimeDir, tmp, uid }: { platform?: NodeJS.Platform; runtimeDir?: string; tmp: string; uid: number }
): string | null => {
  if (platform === 'win32' || Buffer.byteLength(localEndpointPath(dir, protocol, platform)) <= socketPathMax(platform)) return null
  const base = platform === 'linux' && runtimeDir && posix.isAbsolute(runtimeDir) ? runtimeDir : tmp
  return posix.join(base, `hiveoryd-${uid}-${createHash('sha256').update(dir).digest('hex').slice(0, 12)}`)
}
