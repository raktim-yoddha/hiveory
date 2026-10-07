import type { AppError } from '@shared/errors'
import type { PayloadArgs, PhoneChannel, Response } from './contract'

/** A computer this phone is paired with (its token lives in secure storage, never here). */
export interface Computer {
  id: string
  /** Shown to the user: the computer's name on the tailnet. */
  name: string
  /** Its Tailscale name or address. */
  address: string
  port: number
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
  new HiveoryError({ code: 'NOT_FOUND', message: `Can't reach ${computer.name}.`, hint: 'Check that Tailscale is on here and on the computer, and that the computer is awake.' })

/** One typed call to a computer (only channels the phone may use). */
export const call = async <C extends PhoneChannel>(computer: Computer, token: string, channel: C, ...payload: PayloadArgs<C>): Promise<Response<C>> => {
  let res: globalThis.Response
  try {
    res = await fetchWithin(`${baseUrl(computer)}/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ channel, payload: payload[0] })
    })
  } catch {
    throw unreachable(computer)
  }
  if (res.status === 401) throw new HiveoryError({ code: 'FORBIDDEN', message: `${computer.name} no longer knows this phone.`, hint: 'Pair it again from Settings.' })
  const result = (await res.json().catch(() => null)) as { ok: true; value: Response<C> } | { ok: false; error: AppError } | null
  if (!result) throw unreachable(computer)
  if (!result.ok) throw new HiveoryError(result.error)
  return result.value
}

/** Where this phone's "needs you" notifications go on that computer (null stops them). */
export const setPushToken = async (computer: Computer, token: string, pushToken: string | null): Promise<void> => {
  const res = await fetchWithin(`${baseUrl(computer)}/push`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ token: pushToken })
  }).catch(() => null)
  if (!res?.ok) throw unreachable(computer)
}
