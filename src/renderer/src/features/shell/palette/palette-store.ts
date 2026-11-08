import { create } from 'zustand'

/** Whether the command palette (ADR 0060) is open. */
export const usePalette = create<{ open: boolean; toggle(): void; close(): void }>((set) => ({
  open: false,
  toggle: () => set((s) => ({ open: !s.open })),
  close: () => set({ open: false })
}))
