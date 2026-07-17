"use client";

import { useEffect, useState } from "react";
import WorkerBeePane from "./WorkerBeePane";
import TerminalPane from "../terminal/TerminalPane";
import BrowserPane from "../browser/BrowserPane";
import KanbanPanel from "@/features/task-comb/TaskCombPanel";
import { invoke } from "@tauri-apps/api/core";
import { useWorkerBeesStore } from "@/features/worker-bees/workerBeesStore";
import { useWorkspaceStore } from "@/features/workspaces/workspaceStore";

interface WorkerBeesPanelProps {
  workingDir?: string | null;
}

/** Controls inside a pane header that must receive clicks, never start a drag. */
const INTERACTIVE = "button, input, select, textarea, a, [contenteditable], [role='button']";

// Honeybee glyph — lucide has no bee icon, so a small inline SVG keeps the
// bee/hive theme in the empty state. Uses currentColor for the gold accent.
function BeeIcon({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.6} strokeLinecap="round"
      strokeLinejoin="round" className={className} aria-hidden>
      {/* wings */}
      <ellipse cx="7.5" cy="8" rx="3.2" ry="2.2" transform="rotate(-25 7.5 8)" opacity="0.7" />
      <ellipse cx="16.5" cy="8" rx="3.2" ry="2.2" transform="rotate(25 16.5 8)" opacity="0.7" />
      {/* antennae */}
      <path d="M10 6.5 8.5 4M14 6.5 15.5 4" />
      {/* body */}
      <ellipse cx="12" cy="14" rx="4.2" ry="6" />
      {/* stripes */}
      <path d="M8 12.5h8M8.2 15.5h7.6M10 18.3h4" />
    </svg>
  );
}


export default function WorkerBeesPanel({ workingDir }: WorkerBeesPanelProps) {
  const workerBees = useWorkerBeesStore((state) => state.workerBees);
  const replaceAll = useWorkerBeesStore((state) => state.replaceAll);
  const removeWorkerBee = useWorkerBeesStore((state) => state.removeWorkerBee);
  const updateWorkerBee = useWorkerBeesStore((state) => state.updateWorkerBee);
  const maximizedPane = useWorkerBeesStore((state) => state.maximizedPane);
  const setMaximizedPane = useWorkerBeesStore((state) => state.setMaximizedPane);
  const reorderWorkerBees = useWorkerBeesStore((state) => state.reorderWorkerBees);
  const refitTerminals = useWorkerBeesStore((state) => state.refitTerminals);
  const gridLayout = useWorkerBeesStore((state) => state.gridLayout);

  const agentStatuses = useWorkerBeesStore((state) => state.agentStatuses);

  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const boardOpen = useWorkspaceStore((s) => s.boardOpen);
  const setBoardOpen = useWorkspaceStore((s) => s.setBoardOpen);
  const updateWorkspace = useWorkspaceStore((s) => s.updateWorkspace);

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);

  const [editingBee, setEditingBee] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  // Which pane may currently start an HTML5 drag (see the wrapper's onMouseDown).
  const [dragArmed, setDragArmed] = useState<string | null>(null);

  // Sync active workspace's paneLayout → workerBeesStore
  useEffect(() => {
    if (activeWorkspace) {
      replaceAll(activeWorkspace.paneLayout);
    }
  }, [activeWorkspaceId, activeWorkspace?.paneLayout.length]);

  // Sync workerBeesStore → active workspace's paneLayout on changes
  useEffect(() => {
    if (activeWorkspace && workerBees !== activeWorkspace.paneLayout) {
      updateWorkspace(activeWorkspace.id, { paneLayout: workerBees });
    }
  }, [workerBees]);

  // Layout change resizes panes — refit terminals so xterm reflows.
  useEffect(() => {
    const id = requestAnimationFrame(() => refitTerminals());
    return () => cancelAnimationFrame(id);
  }, [gridLayout]);

  // The CDP Chromium is shared by all browser panes; shut it down once the last
  // one closes so it doesn't linger as an orphan process.
  const browserPanes = workerBees.filter((b) => b.kind === "browser").length;
  useEffect(() => {
    if (browserPanes === 0) invoke("stop_cdp_browser").catch(() => {});
  }, [browserPanes]);

  const handleRemoveWorkerBee = (beeId: string) => {
    invoke("kill_terminal", { paneId: beeId })
      .then(() => removeWorkerBee(beeId))
      .catch(() => removeWorkerBee(beeId));
  };

  const toggleMaximize = (beeId: string) => {
    setMaximizedPane(maximizedPane === beeId ? null : beeId);
    requestAnimationFrame(() => refitTerminals());
  };

  const startRename = (beeId: string) => {
    const bee = workerBees.find((b) => b.id === beeId);
    if (bee) {
      setEditingBee(beeId);
      setEditValue(bee.customName || bee.cliName);
    }
  };

  const saveRename = () => {
    if (editingBee) {
      updateWorkerBee(editingBee, { customName: editValue });
      setEditingBee(null);
      setEditValue("");
    }
  };

  const cancelRename = () => {
    setEditingBee(null);
    setEditValue("");
  };

  const count = workerBees.length;

  // Column count for the grid-style layouts (auto / grid / cols / rows / N).
  const colsFor = (): number => {
    if (count <= 1) return 1;
    switch (gridLayout) {
      case "rows": return 1;
      case "cols": return count;
      case "grid": return Math.ceil(Math.sqrt(count));
      case 1: case 2: case 3: case 4: return Math.min(gridLayout, count);
      case "auto":
      default:
        if (count <= 2) return 2;
        if (count <= 6) return 3;
        return 4;
    }
  };

  // Spotlight: first pane large on the left, the rest stacked in a right column.
  const isMaster = gridLayout === "master" && !maximizedPane && count > 1;
  const cols = colsFor();

  const gridStyle = maximizedPane
    // Explicit single cell at exactly the container height: the hidden panes are
    // display:none, so the maximized one must fill the row outright rather than
    // rely on min-height + auto rows.
    ? { gridTemplateColumns: "1fr", gridTemplateRows: "1fr", height: "100%" }
    : isMaster
    ? {
        gridTemplateColumns: "1.7fr 1fr",
        gridTemplateRows: `repeat(${count - 1}, minmax(180px, 1fr))`,
        gridAutoFlow: "row" as const,
      }
    : {
        // minmax(240px, 1fr): rows fill when few, hold 240px each when many so
        // the grid overflows and the container scrolls instead of squashing.
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridAutoRows: "minmax(240px, 1fr)",
      };

  const paneStyle = (index: number) =>
    isMaster ? (index === 0 ? { gridColumn: 1, gridRow: "1 / -1" } : { gridColumn: 2 }) : undefined;

  return (
    <div className="flex-1 flex flex-col bg-bee-canvas/40 relative">
      {/* No toolbar — all controls are in the main title bar */}

      <div
        className="flex-1 min-h-0 p-2 overflow-auto scrollbar-sleek"
        onWheel={(e) => {
          // Terminal panes capture the plain wheel for their own scrollback, so
          // Shift+wheel scrolls the pane grid itself (vertical; sideways if it
          // only overflows horizontally). Works even with the cursor over a pane.
          if (!e.shiftKey) return;
          const el = e.currentTarget;
          if (el.scrollHeight > el.clientHeight) el.scrollTop += e.deltaY;
          else if (el.scrollWidth > el.clientWidth) el.scrollLeft += e.deltaY;
        }}
      >
        {workerBees.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center animate-fade-in">
            <div className="w-16 h-16 rounded-2xl glass flex items-center justify-center shadow-glass animate-scale-in">
              <BeeIcon size={28} className="text-bee-gold" />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium text-bee-textDim">Nothing running</div>
              <div className="text-xs text-bee-textMuted">
                Click <span className="text-bee-gold font-medium">Add</span> to launch a CLI agent, or <span className="text-bee-gold font-medium">Terminal</span> for a shell
              </div>
            </div>
          </div>
        ) : (
          <div className="grid gap-2 min-h-full" style={gridStyle}>
            {workerBees.map((bee, index) => {
              const isThisMaximized = maximizedPane === bee.id;
              const shouldHide = maximizedPane !== null && !isThisMaximized;
              return (
                <div
                  key={bee.id}
                  style={paneStyle(index)}
                  // Armed only while pressing header *background*. A permanently
                  // draggable wrapper hijacks mousedown on the header's own
                  // buttons (maximize/close) and blocks text selection in the
                  // browser pane's URL bar — the drag eats the click.
                  draggable={dragArmed === bee.id && !isThisMaximized}
                  onMouseDown={(e) => {
                    const t = e.target as HTMLElement;
                    if (t.closest(INTERACTIVE)) return;
                    if (t.closest("[data-pane-drag]")) setDragArmed(bee.id);
                  }}
                  onMouseUp={() => setDragArmed(null)}
                  onDragStart={(e) => {
                    const target = e.target as HTMLElement;
                    // Only start a reorder when grabbing a pane header (both agent
                    // and terminal headers carry data-pane-drag), not the body.
                    if (target.closest(INTERACTIVE) || !target.closest("[data-pane-drag]")) {
                      e.preventDefault();
                      return;
                    }
                    setDraggedIndex(index);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => { setDraggedIndex(null); setDragOverIndex(null); setDragArmed(null); }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (draggedIndex !== null && draggedIndex !== index) setDragOverIndex(index);
                  }}
                  onDrop={() => {
                    if (draggedIndex !== null && draggedIndex !== index) reorderWorkerBees(draggedIndex, index);
                    setDraggedIndex(null); setDragOverIndex(null);
                  }}
                  // Maximized = fill the window (over the sidebars, under the
                  // title/status bars). "Hide the siblings" was not enough: with
                  // a single pane there are no siblings, so the button did
                  // nothing visible and read as broken. `fixed` also escapes the
                  // scroll container's clipping.
                  className={`flex flex-col overflow-hidden glass shadow-glass hover:shadow-glass-lg ${
                    isThisMaximized
                      ? "fixed left-0 right-0 top-11 bottom-6 z-50 rounded-none shadow-2xl shadow-black/60"
                      : shouldHide
                      ? "hidden"
                      : "relative h-full rounded-xl transition-all duration-300"
                  } ${draggedIndex === index ? "opacity-30 scale-[0.98]" : ""} ${
                    dragOverIndex === index ? "border border-bee-gold/60 shadow-[0_0_12px_rgba(201,162,39,0.3)]" : ""
                  }`}
                >
                  {bee.kind === "browser" ? (
                    <BrowserPane
                      paneId={bee.id}
                      initialUrl={bee.url}
                      onClose={() => handleRemoveWorkerBee(bee.id)}
                      onToggleMaximize={() => toggleMaximize(bee.id)}
                      isMaximized={isThisMaximized}
                    />
                  ) : bee.kind === "shell" ? (
                    <TerminalPane
                      paneId={bee.id}
                      workingDir={workingDir}
                      tabName={bee.customName || bee.cliName}
                      shellCommand={bee.cli !== "shell" ? bee.cli : undefined}
                      shellLabel={bee.cliName}
                      onRename={editingBee === bee.id ? saveRename : () => startRename(bee.id)}
                      isEditing={editingBee === bee.id}
                      editValue={editValue}
                      onEditChange={setEditValue}
                      onCancelRename={cancelRename}
                      onClose={() => handleRemoveWorkerBee(bee.id)}
                      onToggleMaximize={() => toggleMaximize(bee.id)}
                      isMaximized={isThisMaximized}
                    />
                  ) : (
                    <WorkerBeePane
                      paneId={bee.id}
                      workingDir={workingDir}
                      workerBee={bee}
                      onRename={editingBee === bee.id ? saveRename : () => startRename(bee.id)}
                      isEditing={editingBee === bee.id}
                      editValue={editValue}
                      onEditChange={setEditValue}
                      onCancelRename={cancelRename}
                      onClose={() => handleRemoveWorkerBee(bee.id)}
                      onToggleMaximize={() => toggleMaximize(bee.id)}
                      isMaximized={isThisMaximized}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <KanbanPanel
        open={boardOpen}
        tasks={activeWorkspace?.taskCards ?? []}
        statuses={agentStatuses}
        projectPath={workingDir}
        activeWorkspaceId={activeWorkspaceId}
        onClose={() => setBoardOpen(false)}
      />
    </div>
  );
}
