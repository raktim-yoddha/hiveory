"use client";

import { useEffect, useState } from "react";
import WorkerBeePane from "./WorkerBeePane";
import { invoke } from "@tauri-apps/api/core";
import { useWorkerBeesStore } from "@/stores/workerBeesStore";

interface WorkerBeesPanelProps {
  workingDir?: string | null;
}

export default function WorkerBeesPanel({ workingDir }: WorkerBeesPanelProps) {
  const workerBees = useWorkerBeesStore((state) => state.workerBees);
  const removeWorkerBee = useWorkerBeesStore((state) => state.removeWorkerBee);
  const updateWorkerBee = useWorkerBeesStore((state) => state.updateWorkerBee);
  const maximizedPane = useWorkerBeesStore((state) => state.maximizedPane);
  const setMaximizedPane = useWorkerBeesStore((state) => state.setMaximizedPane);
  const gridLayout = useWorkerBeesStore((state) => state.gridLayout);
  const reorderWorkerBees = useWorkerBeesStore((state) => state.reorderWorkerBees);

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

  const getGridColsCount = () => {
    const count = workerBees.length;
    if (gridLayout !== "auto") {
      // Never show more columns than panes — avoids empty ghost columns.
      return Math.min(gridLayout as number, Math.max(1, count));
    }
    if (count <= 1) return 1;
    if (count <= 2) return 2;
    if (count <= 4) return 2;
    if (count <= 6) return 3;
    if (count <= 9) return 3;
    if (count <= 12) return 4;
    return 4; // 13-16
  };

  return (
    <div className="flex-1 flex flex-col bg-bee-canvas/40 relative">
      <div className="flex-1 min-h-0 p-2 overflow-y-auto">
        {workerBees.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center animate-fade-in">
            <div className="w-16 h-16 rounded-2xl glass flex items-center justify-center text-3xl shadow-glass animate-scale-in">
              🐝
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
