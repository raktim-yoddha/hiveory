import { create } from "zustand";

export interface WorkerBee {
  id: string;
  cli: string;
  cliName: string;
  customName?: string;
  args?: string[];
  // 'agent' (a CLI coding agent, the default) or 'shell' (a plain terminal you
  // can run any command in). Shell panes render TerminalPane instead of WorkerBeePane.
  kind?: 'agent' | 'shell';
}

export type AgentStatus = 'launching' | 'running' | 'idle' | 'error' | 'done';

export type GridLayout = "auto" | 1 | 2 | 3 | 4;

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
  gridLayout: "auto",
  setGridLayout: (layout) => set({ gridLayout: layout }),
  reorderWorkerBees: (fromIndex, toIndex) =>
    set((state) => {
      const result = Array.from(state.workerBees);
      const [removed] = result.splice(fromIndex, 1);
      result.splice(toIndex, 0, removed);
      return { workerBees: result };
    }),
  refitCount: 0,
  refitTerminals: () => set((state) => ({ refitCount: state.refitCount + 1 })),
  replaceAll: (bees) => set({ workerBees: bees }),
}));
