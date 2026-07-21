import { create } from "zustand";
import { persist } from "zustand/middleware";

/** An extension the user downloaded from the Open-VSX marketplace. */
export interface InstalledExtension {
  id: string;        // "namespace.name"
  name: string;      // display name
  publisher: string; // namespace
  icon?: string;     // remote icon URL (open-vsx)
  version?: string;
}

interface ExtState {
  installed: InstalledExtension[];
  install: (e: InstalledExtension) => void;
  uninstall: (id: string) => void;
  isInstalled: (id: string) => boolean;
}

export const useExtensionStore = create<ExtState>()(
  persist(
    (set, get) => ({
      installed: [],
      install: (e) =>
        set((s) => (s.installed.some((x) => x.id === e.id) ? s : { installed: [...s.installed, e] })),
      uninstall: (id) => set((s) => ({ installed: s.installed.filter((x) => x.id !== id) })),
      isInstalled: (id) => get().installed.some((x) => x.id === id),
    }),
    { name: "hive_extensions" },
  ),
);
