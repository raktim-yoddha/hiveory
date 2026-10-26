import { create } from 'zustand'

/** The Create worktree dialog, opened by a Workspace's "+" or its shortcut (ADR 0047); the shell draws it. */
export const useNewWorktree = create<{ projectId: string | null; open(projectId: string): void; close(): void }>((set) => ({
  projectId: null,
  open: (projectId) => set({ projectId }),
  close: () => set({ projectId: null })
}))
