"use client";

import type { ReactNode } from "react";
import { Plus, X, Maximize2, Minimize2 } from "lucide-react";
import { themeForKind } from "./themes";
import HoneyFlowLogo from "./HoneyFlowLogo";

export interface StripItem {
  id: string;
  name: string;
  /** WorkerBee kind — drives the chip accent (agent = gold, shell = blade). */
  kind?: string;
  icon?: ReactNode;
}

/**
 * The HoneyFlow board's top strip: the app logo (only when maximized), a chip
 * per open component (name + close), and the + button to add more. Purely
 * presentational — the host owns state and the add menu.
 */
export default function HoneyFlowStrip({
  items,
  activeId,
  showLogo = false,
  onSelect,
  onClose,
  onAdd,
  addRef,
  fullscreen,
  onToggleFullscreen,
  logoNode,
}: {
  items: StripItem[];
  activeId?: string | null;
  showLogo?: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onAdd: () => void;
  addRef?: React.Ref<HTMLButtonElement>;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
  /** App logo shown when maximized (showLogo); falls back to the HoneyFlow mark. */
  logoNode?: ReactNode;
}) {
  return (
    // Only the tabs scroll horizontally. Logo (left), then the scrolling tab
    // block, then + and maximize pinned in-flow at the right — so + can never
    // slide under the maximize button.
    <div className="flex h-11 shrink-0 items-center gap-1.5 border-b border-bee-border/50 glass-toolbar px-2">
      {showLogo && (logoNode ?? <HoneyFlowLogo size={18} className="shrink-0 text-bee-gold" />)}

      {items.length > 0 && (
      <div className="flex min-w-0 shrink items-center gap-1.5 overflow-x-auto scrollbar-hair">
      {items.map((it) => {
        const t = themeForKind(it.kind);
        const active = activeId === it.id;
        return (
          <div
            key={it.id}
            onClick={() => onSelect(it.id)}
            className="group flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium transition-colors"
            style={{
              borderColor: active ? t.accent : t.border,
              background: active ? t.accentSoft : "transparent",
              color: active ? t.accent : "var(--bee-text-dim, #b9ac93)",
            }}
            title={it.name}
          >
            {it.icon && <span className="shrink-0" style={{ color: t.accent }}>{it.icon}</span>}
            <span className="max-w-[140px] truncate">{it.name}</span>
            <button
              onClick={(e) => { e.stopPropagation(); onClose(it.id); }}
              className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-black/25 group-hover:opacity-100"
              title="Close"
            >
              <X className="size-3" />
            </button>
          </div>
        );
      })}
      </div>
      )}

      {/* + and maximize sit OUTSIDE the scroller (scrollbar spans only the tabs)
          and in normal flow, so + trails the tabs and stops next to maximize —
          never behind it. */}
      <button
        ref={addRef}
        onClick={onAdd}
        className="flex size-7 shrink-0 items-center justify-center rounded-md border border-bee-gold/30 bg-bee-gold/10 text-bee-goldHi transition-colors hover:bg-bee-gold/20"
        title="Add component"
      >
        <Plus className="size-4" />
      </button>
      {onToggleFullscreen && (
        <button
          onClick={onToggleFullscreen}
          className="ml-auto flex size-7 shrink-0 items-center justify-center rounded-md text-bee-textMuted transition-colors hover:bg-black/30 hover:text-bee-text"
          title={fullscreen ? "Restore" : "Maximize plane"}
        >
          {fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
        </button>
      )}
    </div>
  );
}
