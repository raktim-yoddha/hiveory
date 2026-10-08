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

/** Docked under the main area (it lifts the screens), or floating over its bottom at a fixed size. */
export type QueenPlacement = 'docked' | 'floating'

/** Where the floating bar sits along the bottom of the window: dragged by her mark, it snaps to one of three. */
export type QueenSpot = 'left' | 'middle' | 'right'
export const QUEEN_SPOTS: QueenSpot[] = ['left', 'middle', 'right']

interface QueenState {
  placement: QueenPlacement
  /** Floating only: the bar's spot, and whether it is shrunk to just her mark (double-tap it). */
  spot: QueenSpot
  compact: boolean
  card: QueenCard | null
  busy: boolean
  /** Bumped to move focus into the input (shortcut, menu). */
  focusTick: number
  /** Which tab Settings › Queen Bee opens on. */
  settingsTab: QueenSettingsTab
  setSettingsTab(tab: QueenSettingsTab): void
  setPlacement(placement: QueenPlacement): void
  setSpot(spot: QueenSpot): void
  setCompact(compact: boolean): void
  show(card: QueenCard | null): void
  setBusy(busy: boolean): void
  focus(): void
}

const KEY = 'hiveory.queen'

type Saved = Pick<QueenState, 'placement' | 'spot' | 'compact'>

/** Placement is a per-viewer convenience: storage may be missing, defaults always work. A saved "auto-hide" floats now. */
const readSaved = (): Saved => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as { placement?: unknown; spot?: unknown; compact?: unknown }
    return {
      placement: raw.placement === 'auto-hide' || raw.placement === 'floating' ? 'floating' : 'docked',
      spot: QUEEN_SPOTS.includes(raw.spot as QueenSpot) ? (raw.spot as QueenSpot) : 'middle',
      compact: raw.compact === true
    }
  } catch {
    return { placement: 'docked', spot: 'middle', compact: false }
  }
}

const save = (state: Saved): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ placement: state.placement, spot: state.spot, compact: state.compact }))
  } catch {
    // It still applies for this session.
  }
}

export const useQueen = create<QueenState>((set, get) => ({
  ...readSaved(),
  card: null,
  busy: false,
  focusTick: 0,
  settingsTab: 'personality',
  setSettingsTab: (settingsTab) => set({ settingsTab }),
  setPlacement: (placement) => {
    set({ placement })
    save(get())
  },
  setSpot: (spot) => {
    set({ spot })
    save(get())
  },
  setCompact: (compact) => {
    set({ compact })
    save(get())
  },
  show: (card) => set({ card }),
  setBusy: (busy) => set({ busy }),
  // Her shortcut or menu wants the input: a shrunk bar opens up first.
  focus: () => {
    if (get().compact) get().setCompact(false)
    set((s) => ({ focusTick: s.focusTick + 1 }))
  }
}))
