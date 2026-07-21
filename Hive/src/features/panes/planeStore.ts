import { create } from "zustand";
import type { WorkerBee } from "@/features/worker-bees/workerBeesStore";

/**
 * A "plane" is the single kind of surface the center shows at a time. Instead of
 * mixing agents, terminals, browsers and emulators in one grid, each plane holds
 * only its own kind — you switch planes from the title bar, and add items with
 * the plane's own `+`.
 */
export type PlaneKind = "honeyflow" | "browser" | "emulator";

/** The `WorkerBee.kind` a plane contains. `undefined` = a CLI agent. */
export type PaneKind = WorkerBee["kind"];

export interface PlaneDef {
  kind: PlaneKind;
  label: string;
  /** The pane kinds this plane owns. `agent` maps to undefined kind. The
   *  HoneyFlow board merges agents + terminals; browser/emulator stay separate. */
  paneKinds: (NonNullable<PaneKind> | "agent")[];
  /** Distinct accent per section. */
  accent: string;
  /** Softer fill used behind the plane header. */
  accentSoft: string;
}

export const PLANES: PlaneDef[] = [
  { kind: "honeyflow", label: "HoneyFlow", paneKinds: ["agent", "shell", "openvsx"], accent: "#c9a227", accentSoft: "rgba(201,162,39,0.12)" },
  { kind: "browser",   label: "Browser",   paneKinds: ["browser"],        accent: "#3b82f6", accentSoft: "rgba(59,130,246,0.12)" },
  { kind: "emulator",  label: "Emulator",  paneKinds: ["emulator"],       accent: "#06b6d4", accentSoft: "rgba(6,182,212,0.12)" },
];

export function planeFor(kind: PlaneKind): PlaneDef {
  return PLANES.find((p) => p.kind === kind) ?? PLANES[0];
}

/** Does a pane belong to this plane? (agent = kind `undefined`). */
export function paneInPlane(bee: WorkerBee, plane: PlaneDef): boolean {
  return plane.paneKinds.includes(bee.kind ?? "agent");
}

interface PlaneState {
  active: PlaneKind;
  /** Plane fills the whole window, over the title/status bars, until restored. */
  fullscreen: boolean;
  setActive: (k: PlaneKind) => void;
  setFullscreen: (v: boolean) => void;
  toggleFullscreen: () => void;
}

export const usePlaneStore = create<PlaneState>((set) => ({
  active: "honeyflow",
  fullscreen: false,
  setActive: (active) => set({ active }),
  setFullscreen: (fullscreen) => set({ fullscreen }),
  toggleFullscreen: () => set((s) => ({ fullscreen: !s.fullscreen })),
}));
