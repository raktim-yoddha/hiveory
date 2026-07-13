"use client";

import { useEffect, useState } from "react";
import WorkerBeePane from "./WorkerBeePane";
import { invoke } from "@tauri-apps/api/core";
import { useWorkerBeesStore } from "@/stores/workerBeesStore";
import { LayoutList, Columns3, Bot, Hexagon } from "lucide-react";

interface WorkerBeesPanelProps {
  workingDir?: string | null;
  onToggleWorkspaces?: () => void;
  onToggleBoard?: () => void;
  onToggleAgentDock?: () => void;
  workspacesDocked?: boolean;
  queenbeeDocked?: boolean;
}

export default function WorkerBeesPanel({ workingDir, onToggleWorkspaces, onToggleBoard, onToggleAgentDock, workspacesDocked, queenbeeDocked }: WorkerBeesPanelProps) {
  const workerBees = useWorkerBeesStore((state) => state.workerBees);
  const removeWorkerBee = useWorkerBeesStore((state) => state.removeWorkerBee);
  const updateWorkerBee = useWorkerBeesStore((state) => state.updateWorkerBee);
  const maximizedPane = useWorkerBeesStore((state) => state.maximizedPane);
  const setMaximizedPane = useWorkerBeesStore((state) => state.setMaximizedPane);
  const gridLayout = useWorkerBeesStore((state) => state.gridLayout);
  const reorderWorkerBees = useWorkerBeesStore((state) => state.reorderWorkerBees);
  const refitTerminals = useWorkerBeesStore((state) => state.refitTerminals);

  const [editingBee, setEditingBee] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Debug: confirm every WorkerBee (and therefore every grid row) is actually
  // mounted in the tree, so a missing row can be diagnosed as CSS vs. data.
  useEffect(() => {
    console.log(
      `[WorkerBees] ${workerBees.length} bee(s) mounted, layout=${gridLayout}:`,
      workerBees.map((b) => b.id),
    );
  }, [workerBees, gridLayout]);

  const handleRemoveWorkerBee = (beeId: string) => {
    // Kill the pty process first
    invoke("kill_terminal", { paneId: beeId })
      .then(() => {
        removeWorkerBee(beeId);
      })
      .catch((error) => {
        console.error(`Failed to kill WorkerBee: ${beeId}`, error);
        // Still remove the pane even if kill fails
        removeWorkerBee(beeId);
      });
  };

  const toggleMaximize = (beeId: string) => {
    setMaximizedPane(maximizedPane === beeId ? null : beeId);
    // Re-fit all terminals one frame after the CSS layout resolves
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

  // Tailwind's scanner needs literal class strings — a template-interpolated
  // `grid-cols-${n}` would silently fail to generate the utility.
  const FIXED_COLUMN_CLASSES: Record<1 | 2 | 3 | 4, string> = {
    1: "grid-cols-1",
    2: "grid-cols-2",
    3: "grid-cols-3",
    4: "grid-cols-4",
  };

  const dockedCount = (workspacesDocked ? 1 : 0) + (queenbeeDocked ? 1 : 0);

  const getGridColsCount = () => {
    const count = workerBees.length;
    const maxCols = dockedCount === 0 ? 4 : dockedCount === 1 ? 3 : 2;
    if (gridLayout !== "auto") {
      return Math.min(gridLayout as number, maxCols, Math.max(1, count));
    }
    if (count <= 1) return 1;
    if (count <= maxCols) return Math.min(count, maxCols);
    if (count <= maxCols * 2) return maxCols;
    if (count <= maxCols * 3) return maxCols;
    return maxCols;
  };

  return (
    <div className="flex-1 flex flex-col bg-bee-canvas/40 relative">
      {/* ADE toolbar — Workspaces / Board toggles */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-bee-border/50 flex-shrink-0">
        <button
          onClick={onToggleWorkspaces}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-bee-textDim hover:text-bee-text hover:bg-bee-border/40 transition-colors"
        >
          <LayoutList size={12} />
          Workspaces
        </button>
        <button
          onClick={onToggleBoard}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-bee-textDim hover:text-bee-text hover:bg-bee-border/40 transition-colors"
        >
          <Columns3 size={12} />
          Board
        </button>
        <button
          onClick={onToggleAgentDock}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-bee-textDim hover:text-bee-text hover:bg-bee-border/40 transition-colors"
        >
          <Bot size={12} />
          QueenBee
        </button>
      </div>
      <div className="flex-1 min-h-0 p-2 overflow-y-auto">
        {workerBees.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center animate-fade-in">
            <div className="w-16 h-16 rounded-2xl glass flex items-center justify-center shadow-glass animate-scale-in">
              <Hexagon size={28} className="text-bee-gold" />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium text-bee-textDim">No WorkerBees running</div>
              <div className="text-xs text-bee-textMuted">
                Click <span className="text-bee-gold font-medium">Add</span> to
                launch a CLI agent
              </div>
            </div>
          </div>
        ) : (
          <div
            className="grid gap-2 h-full"
            style={{
              gridTemplateColumns: maximizedPane ? "1fr" : `repeat(${getGridColsCount()}, minmax(0, 1fr))`,
              gridAutoRows: maximizedPane ? "1fr" : "1fr",
              minHeight: maximizedPane ? "100%" : `${Math.ceil(workerBees.length / getGridColsCount()) * 240}px`,
            }}
          >
            {workerBees.map((bee, index) => {
              const isThisMaximized = maximizedPane === bee.id;
              const shouldHide = maximizedPane !== null && !isThisMaximized;
              return (
                <div
                  key={bee.id}
                  draggable={!isThisMaximized}
                  onDragStart={(e) => {
                    const target = e.target as HTMLElement;
                    const isHeader = target.closest(".glass-toolbar");
                    if (!isHeader) {
                      e.preventDefault();
                      return;
                    }
                    setDraggedIndex(index);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => {
                    setDraggedIndex(null);
                    setDragOverIndex(null);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (draggedIndex !== null && draggedIndex !== index) {
                      setDragOverIndex(index);
                    }
                  }}
                  onDrop={() => {
                    if (draggedIndex !== null && draggedIndex !== index) {
                      reorderWorkerBees(draggedIndex, index);
                    }
                    setDraggedIndex(null);
                    setDragOverIndex(null);
                  }}
                  className={`flex flex-col relative overflow-hidden rounded-xl glass shadow-glass transition-all duration-300 hover:shadow-glass-lg ${
                    shouldHide ? "hidden" : "h-full"
                  } ${
                    draggedIndex === index ? "opacity-30 scale-[0.98]" : ""
                  } ${
                    dragOverIndex === index ? "border border-bee-gold/60 shadow-[0_0_12px_rgba(201,162,39,0.3)]" : ""
                  }`}
                >
                  <WorkerBeePane
                    paneId={bee.id}
                    workingDir={workingDir}
                    workerBee={bee}
                    onRename={
                      editingBee === bee.id
                        ? saveRename
                        : () => startRename(bee.id)
                    }
                    isEditing={editingBee === bee.id}
                    editValue={editValue}
                    onEditChange={setEditValue}
                    onCancelRename={cancelRename}
                    onClose={() => handleRemoveWorkerBee(bee.id)}
                    onToggleMaximize={() => toggleMaximize(bee.id)}
                    isMaximized={isThisMaximized}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
