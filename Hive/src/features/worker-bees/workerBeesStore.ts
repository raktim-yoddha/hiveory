import { create } from "zustand";

export interface WorkerBee {
  id: string;
  cli: string;
  cliName: string;
  customName?: string;
  args?: string[];
  // 'agent' (a CLI coding agent, the default), 'shell' (a plain terminal),
  // 'browser' (a CDP-driven Chromium view), 'emulator' (Android/AVD), or
  // 'openvsx' (an embedded openvscode-server). Each renders its own pane.
  kind?: 'agent' | 'shell' | 'browser' | 'emulator' | 'openvsx';
  /** browser panes only — page to open on mount */
  url?: string;
  /** openvsx panes — the Open-VSX extension id to install + open, and its icon */
  extensionId?: string;
  iconUrl?: string;
}

export type AgentStatus = 'launching' | 'running' | 'idle' | 'error' | 'done';

// Pane layout presets. The five picker presets (cols2…grid4x2) pin a column
// count (grid* also pin rows); legacy values are kept for the QueenBee tool and
// any persisted workspaces.
export type GridLayout =
  | "cols2" | "cols3" | "cols4" | "grid2x2" | "grid3x2" | "grid4x2" | "focus" | "focus4"
  | "auto" | "grid" | "cols" | "rows" | "master" | 1 | 2 | 3 | 4;

interface WorkerBeesState {
  workerBees: WorkerBee[];
  addWorkerBee: (workerBee: WorkerBee) => void;
  removeWorkerBee: (beeId: string) => void;
  updateWorkerBee: (beeId: string, updates: Partial<WorkerBee>) => void;
  agentStatuses: Record<string, AgentStatus>;
  setAgentStatus: (beeId: string, status: AgentStatus) => void;
  maximizedPane: string | null;
  setMaximizedPane: (paneId: string | null) => void;
  gridLayout: GridLayout;
  setGridLayout: (layout: GridLayout) => void;
  reorderWorkerBees: (fromIndex: number, toIndex: number) => void;
  swapWorkerBees: (fromIndex: number, toIndex: number) => void;
  refitCount: number;
  refitTerminals: () => void;
  replaceAll: (bees: WorkerBee[]) => void;
}

export const useWorkerBeesStore = create<WorkerBeesState>((set) => ({
  workerBees: [],
  addWorkerBee: (workerBee) =>
    set((state) => ({ workerBees: [...state.workerBees, workerBee] })),
  removeWorkerBee: (beeId) =>
    set((state) => {
      const { [beeId]: _, ...rest } = state.agentStatuses;
      return {
        workerBees: state.workerBees.filter((b) => b.id !== beeId),
        maximizedPane: state.maximizedPane === beeId ? null : state.maximizedPane,
        agentStatuses: rest,
      };
    }),
  updateWorkerBee: (beeId, updates) =>
    set((state) => ({
      workerBees: state.workerBees.map((b) =>
        b.id === beeId ? { ...b, ...updates } : b
      ),
    })),
  agentStatuses: {},
  setAgentStatus: (beeId, status) =>
    set((state) => ({
      agentStatuses: { ...state.agentStatuses, [beeId]: status },
    })),
  maximizedPane: null,
  setMaximizedPane: (paneId) => set({ maximizedPane: paneId }),
  gridLayout: "cols2",
  setGridLayout: (layout) => set({ gridLayout: layout }),
  reorderWorkerBees: (fromIndex, toIndex) =>
    set((state) => {
      const result = Array.from(state.workerBees);
      const [removed] = result.splice(fromIndex, 1);
      result.splice(toIndex, 0, removed);
      return { workerBees: result };
    }),
  // Swap two panes in place — used by drag-and-drop so dropping A onto B trades
  // their positions (spotlight follows position), rather than insert-shifting.
  swapWorkerBees: (fromIndex, toIndex) =>
    set((state) => {
      if (
        fromIndex < 0 || toIndex < 0 ||
        fromIndex >= state.workerBees.length || toIndex >= state.workerBees.length ||
        fromIndex === toIndex
      ) return state;
      const result = Array.from(state.workerBees);
      [result[fromIndex], result[toIndex]] = [result[toIndex], result[fromIndex]];
      return { workerBees: result };
    }),
  refitCount: 0,
  refitTerminals: () => set((state) => ({ refitCount: state.refitCount + 1 })),
  replaceAll: (bees) => set({ workerBees: bees }),
}));
