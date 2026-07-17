import { create } from 'zustand';

// Tracks worktrees created by dispatch so they can be approved (merged) or
// discarded later. Without this the branch/path returned by create_worktree is
// lost and merge_worktree has nothing to act on.
export interface DispatchedTask {
  taskId: string;
  title: string;
  cli: string;
  branch: string;
  worktreePath: string;
  dispatchedAt: number;
}

interface DispatchState {
  dispatched: DispatchedTask[];
  record: (task: Omit<DispatchedTask, 'dispatchedAt'>) => void;
  remove: (taskId: string) => void;
  get: (taskId: string) => DispatchedTask | undefined;
}

export const useDispatchStore = create<DispatchState>((set, get) => ({
  dispatched: [],
  record: (task) =>
    set((s) => ({
      dispatched: [...s.dispatched.filter((d) => d.taskId !== task.taskId), { ...task, dispatchedAt: Date.now() }],
    })),
  remove: (taskId) => set((s) => ({ dispatched: s.dispatched.filter((d) => d.taskId !== taskId) })),
  get: (taskId) => get().dispatched.find((d) => d.taskId === taskId),
}));
