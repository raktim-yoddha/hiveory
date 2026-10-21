import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import type { HookEndpoint } from '../cli/adapters/types'

/** Where this computer's daemon (ADR 0050) says how to reach it: its endpoint, pid and token. */
export const LOCAL_ENDPOINT_FILE = 'endpoint.json'

export interface LocalEndpoint {
  protocol: number
  pid: number
  /** Changes with every daemon start, so the app can tell a new daemon from the one it knew. */
  incarnation: string
  path: string
  token: string
  /** The relay agents report hooks to and reach their tools through (ADR 0050 §6). */
  relay?: HookEndpoint
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
