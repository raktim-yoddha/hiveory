import { isHostAddress, parsePairingLink } from '@shared/domain/tailnet'
import { DEFAULT_SERVER_PORT } from '@shared/ipc/remote'
import { baseUrl, fetchWithin, findAddress, HiveoryError, type Computer } from '../api/client'

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
  /** Its other addresses, from the pairing link (ADR 0052). */
  alternates?: string[]
}

/**
 * How this computer is shown: its tailnet machine name (devbox.tail1234.ts.net → devbox), with the
 * port when it is not the default, so two Hiveory servers on one machine never look the same.
 */
export const computerName = (address: string, port = DEFAULT_SERVER_PORT): string => {
  const base = /^[\d.:]+$/.test(address) ? address : (address.split('.')[0] ?? address)
  return port === DEFAULT_SERVER_PORT ? base : `${base}:${port}`
}

/**
 * Pairs with a computer that shares Hiveory (ADR 0025, 0027). The phone asks
 * as a phone, so the computer gives it the phone's channels only. With the
 * same Tailscale account no code is needed; otherwise the code from the QR.
 * Its addresses are tried in turn, and every address it reports is kept, so
 * the phone reaches it over Tailscale or the same Wi-Fi, whichever answers (ADR 0052).
 */
export const pairWith = async (target: PairTarget, deviceName: string, post: typeof fetchWithin = fetchWithin): Promise<{ computer: Computer; token: string }> => {
  const computer: Computer = {
    id: `${target.address}:${target.port}`,
    name: computerName(target.address, target.port),
    address: target.address,
    port: target.port,
    ...(target.alternates?.length ? { alternates: target.alternates } : {})
  }
  const at = await findAddress(computer, post, 8000)
  if (!at) {
    throw new HiveoryError({
      code: 'NOT_FOUND',
      message: `No Hiveory answers at ${target.address}.`,
      hint: 'On the computer, turn on Settings › Remote › Share this computer. Keep Tailscale on both devices, or join the same Wi-Fi.'
    })
  }
  const base = baseUrl({ address: at, port: target.port })
  const res = await post(`${base}/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...(target.code ? { code: target.code.toUpperCase() } : {}), name: deviceName.slice(0, 80), client: 'mobile' })
  })
  const body = (await res.json().catch(() => ({}))) as { token?: string; error?: string; needsCode?: boolean; addresses?: unknown }
  if (res.ok && body.token) {
    const reported = Array.isArray(body.addresses) ? body.addresses.filter(isHostAddress) : []
    const alternates = [...new Set([...(target.alternates ?? []), ...reported])].filter((a) => a !== target.address).slice(0, 8)
    return { computer: { ...computer, ...(alternates.length ? { alternates } : {}) }, token: body.token }
  }
  if (body.needsCode && !target.code) throw new NeedsCodeError()
  throw new HiveoryError({ code: 'FORBIDDEN', message: body.error ?? 'The computer refused to pair.' })
}
