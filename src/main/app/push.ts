const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'
/** Expo takes at most 100 messages per request. */
const BATCH = 100

/**
 * One "needs you" notification for paired phones (ADR 0027). It passes through
 * Expo and Apple or Google, so it says nothing about the work: no project,
 * agent or file names, only opaque ids the phone uses to open the right screen.
 */
export interface PushMessage {
  title: string
  body: string
  data: Record<string, string>
}

/** Sends through Expo's push service; returns the tokens Expo says no longer exist (app removed). */
export const sendPush = async (tokens: string[], message: PushMessage, post: typeof fetch = fetch): Promise<string[]> => {
  const gone: string[] = []
  for (let i = 0; i < tokens.length; i += BATCH) {
    const batch = tokens.slice(i, i + BATCH)
    const res = await post(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(batch.map((to) => ({ to, ...message, sound: 'default', priority: 'high', channelId: 'agents' })))
    })
    const body = (await res.json().catch(() => ({}))) as { data?: Array<{ status?: string; details?: { error?: string } }> }
    body.data?.forEach((ticket, n) => {
      if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') gone.push(batch[n]!)
    })
  }
  return gone
}
