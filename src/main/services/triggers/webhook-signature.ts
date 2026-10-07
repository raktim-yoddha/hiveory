import { createHmac, timingSafeEqual } from 'node:crypto'

/** Older than this, an event is refused: a replayed delivery can't start a run. */
export const MAX_EVENT_AGE_MS = 5 * 60 * 1000

/**
 * Checks a Composio webhook (Standard Webhooks): an HMAC-SHA256 over `{id}.{timestamp}.{rawBody}` with the
 * subscription's secret, base64, in `webhook-signature` (possibly as several space-separated "v1,<sig>"),
 * and a timestamp (seconds) within five minutes. Returns why it fails, or null.
 */
export function signatureProblem(
  headers: { id?: string; timestamp?: string; signature?: string },
  body: string,
  secret: string,
  now = Date.now()
): string | null {
  const { id, timestamp, signature } = headers
  if (!id || !timestamp || !signature || !secret) return 'unsigned'
  const seconds = Number(timestamp)
  if (!Number.isFinite(seconds) || Math.abs(now - seconds * 1000) > MAX_EVENT_AGE_MS) return 'stale'
  const expected = Buffer.from(createHmac('sha256', secret).update(`${id}.${timestamp}.${body}`).digest('base64'))
  const matches = signature
    .split(' ')
    .map((part) => part.slice(part.indexOf(',') + 1))
    .some((sig) => {
      const given = Buffer.from(sig)
      return given.length === expected.length && timingSafeEqual(given, expected)
    })
  return matches ? null : 'bad signature'
}
