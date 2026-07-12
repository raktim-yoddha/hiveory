"use client";

import { useEffect, useRef, useState } from "react";
import {
  Terminal,
  Plus,
  X,
  ChevronDown,
  ChevronUp,
  SplitSquareHorizontal,
  Trash2,
} from "lucide-react";
import TerminalPane from "../terminal/TerminalPane";
import { useWorkerBeesStore } from "../../stores/workerBeesStore";
import { invoke } from "@tauri-apps/api/core";

interface EditorTerminalPanelProps {
  workingDir?: string | null;
  height?: number;
}

interface TermTab {
  id: string;
  name: string;
}

let termSeq = 0;
const nextTermId = () => `editor-term-${Date.now()}-${termSeq++}`;

// VS Code-style multi-terminal panel: a tab strip that can hold any number of
// independent shell terminals. Every terminal stays MOUNTED once created (we
// only hide inactive ones with CSS) so a long-running command keeps executing
// in the background when you switch tabs — exactly like VS Code's integrated
// terminal.
export default function EditorTerminalPanel({
  workingDir,
  height = 256,
}: EditorTerminalPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [tabs, setTabs] = useState<TermTab[]>([{ id: nextTermId(), name: "Terminal 1" }]);
  const [activeId, setActiveId] = useState<string>(() => tabs[0]?.id ?? "");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const refitTerminals = useWorkerBeesStore((s) => s.refitTerminals);

  // Ensure there is always a valid active tab.
  useEffect(() => {
    if (tabs.length === 0) return;
    if (!tabs.some((t) => t.id === activeId)) {
      setActiveId(tabs[tabs.length - 1].id);
    }
  }, [tabs, activeId]);

  // Refit the visible terminal one frame after the active tab (or panel
  // height / collapse state) changes, so xterm re-measures its container.
  useEffect(() => {
    if (collapsed) return;
    const raf = requestAnimationFrame(() => refitTerminals());
    return () => cancelAnimationFrame(raf);
  }, [activeId, collapsed, height, refitTerminals]);

  const addTerminal = () => {
    const n = tabs.length + 1;
    const tab = { id: nextTermId(), name: `Terminal ${n}` };
    setTabs((prev) => [...prev, tab]);
    setActiveId(tab.id);
    setCollapsed(false);
  };

  const closeTerminal = (id: string) => {
    // Terminate the backing PTY so we don't orphan a shell process.
    invoke("kill_terminal", { paneId: id }).catch(() => {
      /* pane may not have spawned yet; ignore */
    });
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      const remaining = prev.filter((t) => t.id !== id);
      // Move focus to a neighbouring tab if we closed the active one.
      if (id === activeId && remaining.length > 0) {
        const next = remaining[Math.min(idx, remaining.length - 1)];
        setActiveId(next.id);
      }
      return remaining;
    });
  };

  const startRename = (tab: TermTab) => {
    setEditingId(tab.id);
    setEditValue(tab.name);
  };

  const commitRename = () => {
    if (editingId) {
      const name = editValue.trim();
      setTabs((prev) =>
        prev.map((t) => (t.id === editingId ? { ...t, name: name || t.name } : t)),
      );
    }
    setEditingId(null);
    setEditValue("");
  };

  // Collapsed: a thin status bar that reopens the panel.
  if (collapsed) {
    return (
      <div className="h-8 glass-toolbar border-t border-bee-border/60 flex items-center justify-between px-3 flex-shrink-0">
        <button
          onClick={() => setCollapsed(false)}
          className="flex items-center gap-2 text-xs text-bee-textDim hover:text-bee-text transition-colors"
        >
          <Terminal size={14} className="text-bee-gold" />
          <span>
            Terminal{tabs.length > 1 ? `s (${tabs.length})` : ""}
          </span>
          <ChevronUp size={13} className="text-bee-textMuted" />
        </button>
        <button
          onClick={addTerminal}
          className="p-1 rounded-md hover:bg-bee-border/60 text-bee-textDim hover:text-bee-text transition-colors"
          title="New terminal"
        >
          <Plus size={13} />
        </button>
      </div>
    );
  }

  return (
    <div
      className="glass-toolbar flex flex-col border-t border-bee-border/60 flex-shrink-0"
      style={{ height: `${height}px` }}
    >
      {/* Panel tab strip (VS Code-style) */}
      <div className="h-8 flex items-center justify-between border-b border-bee-border/50 pl-1 pr-1.5 flex-shrink-0 bg-bee-canvas/30">
        <div className="flex items-center gap-0.5 overflow-x-auto no-scrollbar">
          {tabs.map((tab) => {
            const active = tab.id === activeId;
            return (
              <div
                key={tab.id}
                onClick={() => setActiveId(tab.id)}
                className={`group h-7 flex items-center gap-1.5 pl-2.5 pr-1.5 rounded-md cursor-pointer min-w-max transition-colors ${
                  active
                    ? "bg-bee-surface/70 text-bee-text"
                    : "text-bee-textMuted hover:text-bee-textDim hover:bg-bee-border/30"
                }`}
              >
                <Terminal
                  size={11}
                  className={active ? "text-bee-gold" : "text-bee-textMuted"}
                />
                {editingId === tab.id ? (
                  <input
                    autoFocus
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={commitRename}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename();
                      if (e.key === "Escape") {
                        setEditingId(null);
                        setEditValue("");
                      }
                    }}
                    className="bg-bee-canvas text-bee-text px-1 py-0.5 rounded text-[11px] w-24 focus:outline-none focus:ring-1 focus:ring-bee-gold border border-bee-border"
                  />
                ) : (
                  <span
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      startRename(tab);
                    }}
                    className="text-[11px] font-medium select-none"
                  >
                    {tab.name}
                  </span>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTerminal(tab.id);
                  }}
                  className="p-0.5 rounded hover:bg-bee-err/25 hover:text-bee-err text-bee-textMuted opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Kill terminal"
                >
                  <X size={11} />
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            onClick={addTerminal}
            className="p-1.5 rounded-md hover:bg-bee-border/60 text-bee-textDim hover:text-bee-text transition-colors"
            title="New terminal"
          >
            <Plus size={13} />
          </button>
          <button
            onClick={addTerminal}
            className="p-1.5 rounded-md hover:bg-bee-border/60 text-bee-textDim hover:text-bee-text transition-colors"
            title="Split terminal"
          >
            <SplitSquareHorizontal size={13} />
          </button>
          <button
            onClick={() => setCollapsed(true)}
            className="p-1.5 rounded-md hover:bg-bee-border/60 text-bee-textDim hover:text-bee-text transition-colors"
            title="Hide panel"
          >
            <ChevronDown size={13} />
          </button>
        </div>
      </div>

      {/* Terminal bodies — all kept mounted; only the active one is visible so
          background terminals keep running. */}
      <div className="flex-1 overflow-hidden min-h-0 relative">
        {tabs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
            <Terminal size={22} className="text-bee-textMuted" />
            <div className="text-xs text-bee-textMuted">No terminals open</div>
            <button
              onClick={addTerminal}
              className="mt-1 px-3 py-1 text-xs rounded-md bg-bee-gold/15 text-bee-goldHi hover:bg-bee-gold/25 transition-colors flex items-center gap-1.5"
            >
              <Plus size={12} /> New Terminal
            </button>
          </div>
        ) : (
          tabs.map((tab) => (
            <div
              key={tab.id}
              className="absolute inset-0"
              style={{ display: tab.id === activeId ? "block" : "none" }}
            >
              <TerminalPane
                paneId={tab.id}
                workingDir={workingDir}
                tabName={tab.name}
                onClose={() => closeTerminal(tab.id)}
                closeIconType="trash"
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
