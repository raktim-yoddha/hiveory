import { create } from 'zustand';
import type { WorkerBee } from './workerBeesStore';

export interface Workspace {
  id: string;
  name: string;
  color: string;
  boundProjectPath: string;
  paneLayout: WorkerBee[];
  activeMissionId?: string;
}

export type AppMode = 'editor' | 'ade' | 'board';

interface WorkspaceState {
  workspaces: Workspace[];
  activeWorkspaceId: string;
  mode: AppMode;

  addWorkspace: (workspace: Workspace) => void;
  removeWorkspace: (id: string) => void;
  setActiveWorkspace: (id: string) => void;
  setMode: (mode: AppMode) => void;
  updateWorkspace: (id: string, updates: Partial<Workspace>) => void;
  renameWorkspace: (id: string, name: string) => void;
  setWorkspaceColor: (id: string, color: string) => void;
  getActiveWorkspace: () => Workspace | undefined;
}

const WORKSPACE_COLORS = ['#c9a227', '#22c55e', '#3b82f6', '#a855f7', '#ef4444', '#06b6d4'];

let wsSeq = 0;
function nextWsId() { return `ws-${Date.now()}-${wsSeq++}`; }

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaces: [{
    id: nextWsId(),
    name: 'Default',
    color: WORKSPACE_COLORS[0],
    boundProjectPath: '',
    paneLayout: [],
  }],
  activeWorkspaceId: '',
  mode: 'editor',

  addWorkspace: (workspace) =>
    set((state) => ({ workspaces: [...state.workspaces, workspace], activeWorkspaceId: workspace.id })),

  removeWorkspace: (id) =>
    set((state) => {
      const remaining = state.workspaces.filter((w) => w.id !== id);
      if (remaining.length === 0) return state;
      return {
        workspaces: remaining,
        activeWorkspaceId: state.activeWorkspaceId === id ? remaining[0].id : state.activeWorkspaceId,
      };
    }),

  setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),

  setMode: (mode) => set({ mode }),

  updateWorkspace: (id, updates) =>
    set((state) => ({
      workspaces: state.workspaces.map((w) => (w.id === id ? { ...w, ...updates } : w)),
    })),

  renameWorkspace: (id, name) =>
    set((state) => ({
      workspaces: state.workspaces.map((w) => (w.id === id ? { ...w, name } : w)),
    })),

  setWorkspaceColor: (id, color) =>
    set((state) => ({
      workspaces: state.workspaces.map((w) => (w.id === id ? { ...w, color } : w)),
    })),

  getActiveWorkspace: () => {
    const state = get();
    return state.workspaces.find((w) => w.id === state.activeWorkspaceId);
  },
}));
