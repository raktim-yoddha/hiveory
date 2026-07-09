import { create } from "zustand";

export interface WorkerBee {
  id: string;
  cli: string;
  cliName: string;
  customName?: string;
  args?: string[];
}

export type GridLayout = "auto" | 1 | 2 | 3 | 4;

interface TerminalState {
  workerBees: WorkerBee[];
  addWorkerBee: (workerBee: WorkerBee) => void;
  removeWorkerBee: (beeId: string) => void;
  updateWorkerBee: (beeId: string, updates: Partial<WorkerBee>) => void;
  maximizedPane: string | null;
  setMaximizedPane: (paneId: string | null) => void;
  gridLayout: GridLayout;
  setGridLayout: (layout: GridLayout) => void;
}

export const useTerminalStore = create<TerminalState>((set) => ({
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
}));
