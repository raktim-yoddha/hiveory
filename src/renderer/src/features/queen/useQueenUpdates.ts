import { useEffect } from 'react'
import { prefsFromSettings, updateLine } from '@shared/queen/personas'
import { buildReport } from '@shared/queen/report'
import type { QueenUpdate } from '@shared/queen/updates'
import { subscribe } from '../../lib/api'
import { useSettings } from '../../stores/data'
import { useQueen } from './useQueen'
import { cue, speak } from './voice'

/** Updates arriving this close together are told as one. */
const BATCH_MS = 700

let pending: QueenUpdate[] = []
let timer: number | null = null

const wanted = (u: QueenUpdate): boolean => {
  const mode = useSettings.getState().settings.queenUpdates
  return mode === 'all' || (mode === 'waiting' && u.kind !== 'finished')
}

/** A question or a yes/no on screen stays until it is answered; updates wait behind it. */
const blocked = (): boolean => {
  const { busy, card } = useQueen.getState()
  return busy || card?.kind === 'confirm' || card?.kind === 'ask'
}

function flush(): void {
  timer = null
  if (!pending.length || blocked()) return
  const batch = pending
  pending = []
  const settings = useSettings.getState().settings
  const prefs = prefsFromSettings(settings)
  const text = batch.map((u) => updateLine(u, prefs)).join(' ')
  const last = batch.at(-1)!
  useQueen.getState().show({
    kind: 'reply',
    text,
    receipts: [],
    report: buildReport(
      batch.map((u) => ({
        id: u.instanceId,
        projectId: u.projectId,
        workspaceId: u.workspaceId,
        petName: u.petName,
        cliName: u.cliName,
        workspaceName: u.workspaceName,
        status: u.kind === 'waiting' ? 'waiting-for-you' : 'idle'
      })),
      'all'
    ),
    ...(batch.length === 1 && last.excerpt ? { quote: last.excerpt } : {})
  })
  cue('update')
  if (settings.queenTalkback === 'always') void speak(text)
}

const queue = (u: QueenUpdate): void => {
  if (!wanted(u)) return
  // A newer update about the same agent replaces the older one.
  pending = [...pending.filter((p) => p.instanceId !== u.instanceId), u]
  if (timer === null) timer = window.setTimeout(flush, BATCH_MS)
}

/**
 * Queen Bee's live updates (ADR 0019): an agent finished, needs you, or stopped —
 * whether or not she started the work. Shown on her card with a jump-to row and
 * the agent's own last words, and said out loud when talkback is on.
 */
export function useQueenUpdates(): void {
  useEffect(() => {
    const off = subscribe('queen.update', queue)
    // Updates held behind a question show once it is answered.
    const unwatch = useQueen.subscribe((state, before) => {
      const changed = state.card !== before.card || state.busy !== before.busy
      if (pending.length && timer === null && changed && !blocked()) timer = window.setTimeout(flush, BATCH_MS)
    })
    return () => {
      off()
      unwatch()
    }
  }, [])
}
