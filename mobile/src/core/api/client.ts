import type { AppError } from '@shared/errors'
import type { PayloadArgs, PhoneChannel, Response } from './contract'

/** A computer this phone is paired with (its token lives in secure storage, never here). */
export interface Computer {
  id: string
  /** Shown to the user: the computer's name on the tailnet. */
  name: string
  /** Its Tailscale name or address (or its Wi-Fi address, when paired there). */
  address: string
  port: number
  /** Its other addresses on the same port (Tailscale name or IP, Wi-Fi): tried when `address` does not answer (ADR 0052). */
  alternates?: string[]
}

/** A failed call, with the computer's own error (code, message, hint) when it answered. */
export class HiveoryError extends Error {
  constructor(readonly error: AppError) {
    super(error.message)
  }
}

const CALL_TIMEOUT_MS = 20_000

export const baseUrl = (c: Pick<Computer, 'address' | 'port'>): string => `http://${c.address.includes(':') ? `[${c.address}]` : c.address}:${c.port}`

/** fetch with a deadline (a sleeping laptop or a dropped tailnet must not hang a screen). */
export const fetchWithin = async (url: string, init: RequestInit = {}, ms = CALL_TIMEOUT_MS): Promise<globalThis.Response> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

const unreachable = (computer: Computer): HiveoryError =>
  new HiveoryError({
    code: 'NOT_FOUND',
    message: `Can't reach ${computer.name}.`,
    hint: 'Check that the computer is awake, and that this phone has Tailscale on or is on the same Wi-Fi.'
  })

/** The address of each computer that answered last (ADR 0052): calls go there until it stops answering. */
const reached = new Map<string, string>()

/** Every address of a computer, the one that answered last first. */
export const addressesOf = (c: Pick<Computer, 'id' | 'address' | 'alternates'>): string[] => {
  const all = [c.address, ...(c.alternates ?? [])]
  const last = reached.get(c.id)
  return last && all.includes(last) ? [last, ...all.filter((a) => a !== last)] : all
}

/** Where calls to this computer go now. */
export const reachUrl = (c: Computer): string => baseUrl({ address: addressesOf(c)[0]!, port: c.port })

const HEALTH_MS = 2500

/** The first of a computer's addresses that answers as Hiveory, remembered for its later calls; null when none does. */
export const findAddress = async (c: Computer, get: typeof fetchWithin = fetchWithin, ms = HEALTH_MS): Promise<string | null> => {
  for (const address of addressesOf(c)) {
    const ok = await get(`${baseUrl({ address, port: c.port })}/health`, {}, ms)
      .then(async (r) => r.ok && ((await r.json()) as { app?: string }).app === 'hiveory')
      .catch(() => false)
    if (ok) {
      reached.set(c.id, address)
      return address
    }
  }
  return null
}

/** One typed call to a computer (only channels the phone may use). */
export const call = async <C extends PhoneChannel>(computer: Computer, token: string, channel: C, ...payload: PayloadArgs<C>): Promise<Response<C>> => {
  const post = (base: string) =>
    fetchWithin(`${base}/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ channel, payload: payload[0] })
    })
  const tried = addressesOf(computer)[0]
  let res: globalThis.Response
  try {
    res = await post(reachUrl(computer))
  } catch {
    // Tailscale off, or the phone left the Wi-Fi: another of its addresses may answer (ADR 0052).
    // ponytail: only a different address is retried, so a call that did arrive is never run twice there.
    const other = computer.alternates?.length ? await findAddress(computer) : null
    if (!other || other === tried) throw unreachable(computer)
    res = await post(reachUrl(computer)).catch(() => {
      throw unreachable(computer)
    })
  }
  if (res.status === 401) throw new HiveoryError({ code: 'FORBIDDEN', message: `${computer.name} no longer knows this phone.`, hint: 'Pair it again from Settings.' })
  const result = (await res.json().catch(() => null)) as { ok: true; value: Response<C> } | { ok: false; error: AppError } | null
  if (!result) throw unreachable(computer)
  if (!result.ok) throw new HiveoryError(result.error)
  return result.value
}

/** Where this phone's "needs you" notifications go on that computer (null stops them). */
export const setPushToken = async (computer: Computer, token: string, pushToken: string | null): Promise<void> => {
  const res = await fetchWithin(`${reachUrl(computer)}/push`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ token: pushToken })
  }).catch(() => null)
  if (!res?.ok) throw unreachable(computer)
}
