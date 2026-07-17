import { create } from 'zustand';

// Chrome (sidebar/dock) visibility lives in a store rather than HomePage-local
// state so QueenBee's tools can toggle it the same way the title-bar buttons do.
interface UiState {
  leftOpen: boolean;
  rightOpen: boolean;
  setLeftOpen: (open: boolean) => void;
  setRightOpen: (open: boolean) => void;
  toggleLeft: () => void;
  toggleRight: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  leftOpen: true,
  rightOpen: true,
  setLeftOpen: (open) => set({ leftOpen: open }),
  setRightOpen: (open) => set({ rightOpen: open }),
  toggleLeft: () => set((s) => ({ leftOpen: !s.leftOpen })),
  toggleRight: () => set((s) => ({ rightOpen: !s.rightOpen })),
}));
