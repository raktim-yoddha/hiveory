import { create } from 'zustand'
import type { QueenQuestion } from '@shared/queen/actions'
import type { QueenReport } from '@shared/queen/report'

/** The one card above Queen Bee's bar: her reply, a yes/no, or a question. */
export type QueenCard = (
  | {
      kind: 'reply'
      text: string
      receipts: string[]
      undo?: () => Promise<void>
      report?: QueenReport
      /** An agent's own last words (its screen or chat), shown labelled — never rephrased. */
      quote?: string
    }
  | { kind: 'confirm'; text: string; /** The yes button: Close, Send or Confirm. */ label: string; run: () => Promise<void> }
  | { kind: 'ask'; question: QueenQuestion }
) & {
  /** What she heard, when the command was spoken. */
  heard?: string
}

export type QueenSettingsTab = 'personality' | 'providers' | 'voice' | 'bar'

/** Docked under the main area, or hidden until the bottom edge is pointed at (or she has something to say). */
export type QueenPlacement = 'docked' | 'auto-hide'

interface QueenState {
  placement: QueenPlacement
  card: QueenCard | null
  busy: boolean
  /** Bumped to move focus into the input (shortcut, menu). */
  focusTick: number
  /** Which tab Settings › Queen Bee opens on. */
  settingsTab: QueenSettingsTab
  setSettingsTab(tab: QueenSettingsTab): void
  setPlacement(placement: QueenPlacement): void
  show(card: QueenCard | null): void
  setBusy(busy: boolean): void
  focus(): void
}

const KEY = 'hiveory.queen'

/** Placement is a per-viewer convenience: storage may be missing, defaults always work. An old "floating" is auto-hide now. */
const readPlacement = (): QueenPlacement => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as { placement?: unknown }
    return raw.placement === 'auto-hide' || raw.placement === 'floating' ? 'auto-hide' : 'docked'
  } catch {
    return 'docked'
  }
}

export const useQueen = create<QueenState>((set) => ({
  placement: readPlacement(),
  card: null,
  busy: false,
  focusTick: 0,
  settingsTab: 'personality',
  setSettingsTab: (settingsTab) => set({ settingsTab }),
  setPlacement: (placement) => {
    set({ placement })
    try {
      localStorage.setItem(KEY, JSON.stringify({ placement }))
    } catch {
      // Placement still applies for this session.
    }
  },
  show: (card) => set({ card }),
  setBusy: (busy) => set({ busy }),
  focus: () => set((s) => ({ focusTick: s.focusTick + 1 }))
}))
