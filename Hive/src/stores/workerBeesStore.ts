import { create } from "zustand";

// WorkerBees are a standalone feature (AGENTS.md §5): CLI agent processes
// wired to Nectar, not plain shell terminals. This store only ever holds
// WorkerBee state — the plain-terminal UI in `components/terminal/` doesn't
// use it at all.
export interface WorkerBee {
  id: string;
  cli: string;
  cliName: string;
  customName?: string;
  args?: string[];
}

export type GridLayout = "auto" | 1 | 2 | 3 | 4;

interface WorkerBeesState {
  workerBees: WorkerBee[];
  addWorkerBee: (workerBee: WorkerBee) => void;
  removeWorkerBee: (beeId: string) => void;
  updateWorkerBee: (beeId: string, updates: Partial<WorkerBee>) => void;
  maximizedPane: string | null;
  setMaximizedPane: (paneId: string | null) => void;
  gridLayout: GridLayout;
  setGridLayout: (layout: GridLayout) => void;
  reorderWorkerBees: (fromIndex: number, toIndex: number) => void;
}

export const useWorkerBeesStore = create<WorkerBeesState>((set) => ({
  workerBees: [],
  addWorkerBee: (workerBee) =>
    set((state) => ({ workerBees: [...state.workerBees, workerBee] })),
  removeWorkerBee: (beeId) =>
    set((state) => ({
      workerBees: state.workerBees.filter((b) => b.id !== beeId),
      maximizedPane: state.maximizedPane === beeId ? null : state.maximizedPane,
    })),
  updateWorkerBee: (beeId, updates) =>
    set((state) => ({
      workerBees: state.workerBees.map((b) =>
        b.id === beeId ? { ...b, ...updates } : b
      ),
    })),
  maximizedPane: null,
  setMaximizedPane: (paneId) => set({ maximizedPane: paneId }),
  gridLayout: "auto",
  setGridLayout: (layout) => set({ gridLayout: layout }),
  reorderWorkerBees: (fromIndex, toIndex) =>
    set((state) => {
      const result = Array.from(state.workerBees);
      const [removed] = result.splice(fromIndex, 1);
      result.splice(toIndex, 0, removed);
      return { workerBees: result };
    }),
}));
