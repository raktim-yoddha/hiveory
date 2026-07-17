import { create } from "zustand";

export interface Screenshot {
  /** base64 PNG (no data: prefix) */
  data: string;
  url: string;
  takenAt: number;
}

/** A live browser pane exposes these so agents can drive it. */
export interface BrowserControls {
  capture: () => Promise<Screenshot | null>;
  navigate: (url: string) => void;
}

interface BrowserState {
  /** Latest screenshot per browser pane. */
  screenshots: Record<string, Screenshot>;
  setScreenshot: (paneId: string, shot: Screenshot) => void;
  clearScreenshot: (paneId: string) => void;
  /** Most recent capture across all panes — what QueenBee reaches for. */
  latestScreenshot: () => (Screenshot & { paneId: string }) | null;

  /** Panes register their controls while mounted and ready. */
  controls: Record<string, BrowserControls>;
  registerControls: (paneId: string, c: BrowserControls) => void;
  unregisterControls: (paneId: string) => void;
  /** Drive the first available browser pane. Null when none is open. */
  captureActive: (url?: string) => Promise<(Screenshot & { paneId: string }) | null>;
}

export const useBrowserStore = create<BrowserState>((set, get) => ({
  screenshots: {},
  setScreenshot: (paneId, shot) =>
    set((state) => ({ screenshots: { ...state.screenshots, [paneId]: shot } })),
  clearScreenshot: (paneId) =>
    set((state) => {
      const { [paneId]: _, ...rest } = state.screenshots;
      return { screenshots: rest };
    }),
  latestScreenshot: () => {
    const entries = Object.entries(get().screenshots);
    if (entries.length === 0) return null;
    const [paneId, shot] = entries.reduce((a, b) => (b[1].takenAt > a[1].takenAt ? b : a));
    return { paneId, ...shot };
  },

  controls: {},
  registerControls: (paneId, c) =>
    set((state) => ({ controls: { ...state.controls, [paneId]: c } })),
  unregisterControls: (paneId) =>
    set((state) => {
      const { [paneId]: _, ...rest } = state.controls;
      return { controls: rest };
    }),
  captureActive: async (url) => {
    const entries = Object.entries(get().controls);
    if (entries.length === 0) return null;
    const [paneId, c] = entries[0];
    if (url) {
      c.navigate(url);
      // Give the page a moment to load before grabbing the frame.
      await new Promise((r) => setTimeout(r, 1500));
    }
    const shot = await c.capture();
    return shot ? { paneId, ...shot } : null;
  },
}));
