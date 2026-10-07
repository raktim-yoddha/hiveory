import { parsePairingLink } from '@shared/domain/tailnet'
import { DEFAULT_SERVER_PORT } from '@shared/ipc/remote'
import { baseUrl, fetchWithin, HiveoryError, type Computer } from '../api/client'

export { parsePairingLink, DEFAULT_SERVER_PORT }

/** The computer wants its one-time code (this phone is on another Tailscale account, or it has no owner check). */
export class NeedsCodeError extends Error {
  constructor() {
    super('Enter the pairing code shown on the computer.')
  }
}

export interface PairTarget {
  address: string
  port: number
  code?: string
}

/** How this computer is shown: its tailnet machine name (devbox.tail1234.ts.net → devbox). */
export const computerName = (address: string): string => (/^[\d.:]+$/.test(address) ? address : (address.split('.')[0] ?? address))

/**
 * Pairs with a computer that shares Hiveory (ADR 0025, 0027). The phone asks
 * as a phone, so the computer gives it the phone's channels only. With the
 * same Tailscale account no code is needed; otherwise the code from the QR.
 */
export const pairWith = async (target: PairTarget, deviceName: string, post: typeof fetchWithin = fetchWithin): Promise<{ computer: Computer; token: string }> => {
  const base = baseUrl(target)
  const health = await post(`${base}/health`, {}, 8000).catch(() => null)
  const info = (await health?.json().catch(() => null)) as { app?: string } | null
  if (!health?.ok || info?.app !== 'hiveory') {
    throw new HiveoryError({
      code: 'NOT_FOUND',
      message: `No Hiveory answers at ${target.address}.`,
      hint: 'On the computer, turn on Settings › Remote › Share this computer, and keep Tailscale on both devices.'
    })
  }
  const res = await post(`${base}/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...(target.code ? { code: target.code.toUpperCase() } : {}), name: deviceName.slice(0, 80), client: 'mobile' })
  })
  const body = (await res.json().catch(() => ({}))) as { token?: string; error?: string; needsCode?: boolean }
  if (res.ok && body.token) {
    return { computer: { id: `${target.address}:${target.port}`, name: computerName(target.address), address: target.address, port: target.port }, token: body.token }
  }
  if (body.needsCode && !target.code) throw new NeedsCodeError()
  throw new HiveoryError({ code: 'FORBIDDEN', message: body.error ?? 'The computer refused to pair.' })
}
