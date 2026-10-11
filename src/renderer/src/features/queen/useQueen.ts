import { create } from 'zustand'
import { useSettings } from '../../stores/data'
import { useNavigation } from '../../stores/navigation'
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

/**
 * Docked under the main area (it lifts the screens), floating over its bottom at a fixed size, or put
 * away in the title bar: only her mark there, the bar drops down when called (ADR 0044).
 */
export type QueenPlacement = 'docked' | 'floating' | 'titlebar'

/** Where the floating bar sits along the bottom of the window: dragged by her mark, it snaps to one of three. */
export type QueenSpot = 'left' | 'middle' | 'right'
export const QUEEN_SPOTS: QueenSpot[] = ['left', 'middle', 'right']

interface QueenState {
  placement: QueenPlacement
  /** Floating only: the bar's spot, and whether it is shrunk to just her mark (double-tap it). */
  spot: QueenSpot
  compact: boolean
  /** Title bar only: whether her bar is dropped down under her mark. */
  summoned: boolean
  setSummoned(summoned: boolean): void
  card: QueenCard | null
  /** Whether the card is on screen. Updates arrive closed; her button opens and closes the card. */
  cardOpen: boolean
  /** A closed card holds something not seen yet (her button shows a dot). */
  unseen: boolean
  busy: boolean
  /** Bumped to move focus into the input (shortcut, menu). */
  focusTick: number
  /** Which tab Settings › Queen Bee opens on. */
  settingsTab: QueenSettingsTab
  setSettingsTab(tab: QueenSettingsTab): void
  setPlacement(placement: QueenPlacement): void
  setSpot(spot: QueenSpot): void
  setCompact(compact: boolean): void
  /** `quiet`: keep it behind her button instead of opening it (updates nobody asked for). */
  show(card: QueenCard | null, quiet?: boolean): void
  setCardOpen(open: boolean): void
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
      placement: raw.placement === 'auto-hide' || raw.placement === 'floating' ? 'floating' : raw.placement === 'titlebar' ? 'titlebar' : 'docked',
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
  summoned: false,
  setSummoned: (summoned) => set({ summoned }),
  card: null,
  cardOpen: false,
  unseen: false,
  busy: false,
  focusTick: 0,
  settingsTab: 'personality',
  setSettingsTab: (settingsTab) => set({ settingsTab }),
  setPlacement: (placement) => {
    set({ placement, summoned: false })
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
  // Replies wait behind her button unless Settings › Queen Bee › Pop up replies is on; a question or a
  // yes/no still opens, since the command waits for that answer (ADR 0039).
  show: (card, quiet = false) => {
    const hold = quiet || (card?.kind === 'reply' && !useSettings.getState().settings.queenPopups)
    // Put away in the title bar, a card that opens drops her bar down with it.
    const summon = get().placement === 'titlebar' && Boolean(card) && !hold ? { summoned: true } : {}
    set(card ? (hold ? { card, cardOpen: false, unseen: true } : { card, cardOpen: true, unseen: false, ...summon }) : { cardOpen: false })
  },
  setCardOpen: (cardOpen) => set(cardOpen ? { cardOpen, unseen: false } : { cardOpen }),
  setBusy: (busy) => set({ busy }),
  // Her shortcut or menu wants the input: a shrunk bar opens up first.
  focus: () => {
    if (get().compact) get().setCompact(false)
    // Settings is a window over the app (ADR 0039): calling her closes it, or she couldn't take the keys.
    if (useNavigation.getState().view.type === 'settings') useNavigation.getState().closeSettings()
    set((s) => ({ focusTick: s.focusTick + 1, ...(s.placement === 'titlebar' ? { summoned: true } : {}) }))
  }
}))
