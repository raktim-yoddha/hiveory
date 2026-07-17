import { create } from 'zustand';

interface ProjectState {
  projectPath: string | null;
  setProjectPath: (path: string) => void;
  openFiles: string[];
  setOpenFiles: (files: string[]) => void;
  activeFile: string | null;
  setActiveFile: (file: string | null) => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  projectPath: null,
  setProjectPath: (path) => set({ projectPath: path }),
  openFiles: [],
  setOpenFiles: (files) => set({ openFiles: files }),
  activeFile: null,
  setActiveFile: (file) => set({ activeFile: file }),
}));
