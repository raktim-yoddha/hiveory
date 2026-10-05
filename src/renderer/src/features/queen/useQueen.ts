import { create } from 'zustand'
import type { QueenQuestion } from '@shared/queen/actions'
import type { QueenReport } from '@shared/queen/report'

/** The one card above Queen Bee's bar: her reply, a yes/no, or a question. */
export type QueenCard =
  | { kind: 'reply'; text: string; receipts: string[]; undo?: () => Promise<void>; report?: QueenReport }
  | { kind: 'confirm'; text: string; run: () => Promise<void> }
  | { kind: 'ask'; question: QueenQuestion }

export interface QueenPoint {
  x: number
  y: number
}

interface QueenState {
  placement: 'docked' | 'floating'
  /** Floating: top-left corner in window pixels (null = default spot). */
  position: QueenPoint | null
  /** Floating: shrunk to the hive mark. */
  compact: boolean
  card: QueenCard | null
  busy: boolean
  /** Bumped to move focus into the input (shortcut, menu). */
  focusTick: number
  setPlacement(placement: QueenState['placement']): void
  setPosition(position: QueenPoint | null): void
  setCompact(compact: boolean): void
  show(card: QueenCard | null): void
  setBusy(busy: boolean): void
  focus(): void
}

const KEY = 'hiveory.queen'

/** Placement is a per-viewer convenience: storage may be missing, defaults always work. */
const read = (): Pick<QueenState, 'placement' | 'position' | 'compact'> => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Record<string, unknown>>
    const position = raw.position as QueenPoint | undefined
    return {
      placement: raw.placement === 'floating' ? 'floating' : 'docked',
      position: position && Number.isFinite(position.x) && Number.isFinite(position.y) ? position : null,
      compact: raw.compact === true
    }
  } catch {
    return { placement: 'docked', position: null, compact: false }
  }
}

const save = (s: Pick<QueenState, 'placement' | 'position' | 'compact'>): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ placement: s.placement, position: s.position, compact: s.compact }))
  } catch {
    // Placement still applies for this session.
  }
}

export const useQueen = create<QueenState>((set, get) => ({
  ...read(),
  card: null,
  busy: false,
  focusTick: 0,
  setPlacement: (placement) => {
    set({ placement, compact: false })
    save(get())
  },
  setPosition: (position) => {
    set({ position })
    save(get())
  },
  setCompact: (compact) => {
    set({ compact })
    save(get())
  },
  show: (card) => set({ card }),
  setBusy: (busy) => set({ busy }),
  focus: () => set((s) => ({ compact: false, focusTick: s.focusTick + 1 }))
}))
