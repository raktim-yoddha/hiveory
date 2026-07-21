/**
 * Per-component-type theming for the HoneyFlow board.
 *
 * HoneyFlow hosts several component kinds side by side, each with its own
 * accent so you can tell them apart at a glance: WorkerBees stay honey-gold,
 * terminals get a cool "blade" steel. Coworkers and Open-VSX extensions will
 * get their own entries when they land.
 */
export type ComponentKind = "agent" | "shell" | "openvsx" | "coworker";

export interface ComponentTheme {
  /** Solid accent (icons, active text). */
  accent: string;
  /** Low-opacity fill (chips, header wash). */
  accentSoft: string;
  /** Border/edge tint. */
  border: string;
}

export const COMPONENT_THEMES: Record<string, ComponentTheme> = {
  agent: { accent: "#c9a227", accentSoft: "rgba(201,162,39,0.14)", border: "rgba(201,162,39,0.34)" },
  shell: { accent: "#9fb2c9", accentSoft: "rgba(159,178,201,0.14)", border: "rgba(159,178,201,0.34)" },
  openvsx: { accent: "#a78bfa", accentSoft: "rgba(167,139,250,0.14)", border: "rgba(167,139,250,0.34)" },
};

/** Theme for a WorkerBee kind; `undefined` (a CLI agent) → the agent theme. */
export function themeForKind(kind?: string): ComponentTheme {
  return COMPONENT_THEMES[kind ?? "agent"] ?? COMPONENT_THEMES.agent;
}
