import { useEffect, useState } from 'react'
import type { Handoff } from '@shared/domain/bot'
import { api } from '../../lib/api'
import { useBots } from '../../stores/bots'

// ponytail: handoffs are polled while a page shows them; push them through state.changed if this ever matters.
const HANDOFF_POLL_MS = 10_000

/** Work bots are handing each other, going now or in the last day; refreshed while mounted. */
export function useHandoffs(): Handoff[] {
  const bots = useBots((s) => s.bots)
  const [handoffs, setHandoffs] = useState<Handoff[]>([])
  useEffect(() => {
    let alive = true
    const load = (): void => void api('bots.handoffs').then((h) => alive && setHandoffs(h), () => undefined)
    load()
    const timer = setInterval(load, HANDOFF_POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [bots])
  return handoffs
}
