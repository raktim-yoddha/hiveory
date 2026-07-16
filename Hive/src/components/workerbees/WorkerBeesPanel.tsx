"use client";

import { useEffect, useState } from "react";
import WorkerBeePane from "./WorkerBeePane";
import TerminalPane from "../terminal/TerminalPane";
import MissionBoard from "../board/MissionBoard";
import { invoke } from "@tauri-apps/api/core";
import { useWorkerBeesStore } from "@/stores/workerBeesStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { Hexagon } from "lucide-react";

interface WorkerBeesPanelProps {
  workingDir?: string | null;
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

  const getGridColsCount = () => {
    const count = workerBees.length;
    if (count <= 1) return 1;
    if (count <= 2) return 2;
    if (count <= 4) return 2;
    return 3;
  };

  return (
    <div className="flex-1 flex flex-col bg-bee-canvas/40 relative">
      {/* No toolbar — all controls are in the main title bar */}

      <div className="flex-1 min-h-0 p-2 overflow-y-auto">
        {workerBees.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center animate-fade-in">
            <div className="w-16 h-16 rounded-2xl glass flex items-center justify-center shadow-glass animate-scale-in">
              <Hexagon size={28} className="text-bee-gold" />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium text-bee-textDim">Nothing running</div>
              <div className="text-xs text-bee-textMuted">
                Click <span className="text-bee-gold font-medium">Add</span> to launch a CLI agent, or <span className="text-bee-gold font-medium">Terminal</span> for a shell
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
                    if (!isHeader) { e.preventDefault(); return; }
                    setDraggedIndex(index);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => { setDraggedIndex(null); setDragOverIndex(null); }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (draggedIndex !== null && draggedIndex !== index) setDragOverIndex(index);
                  }}
                  onDrop={() => {
                    if (draggedIndex !== null && draggedIndex !== index) reorderWorkerBees(draggedIndex, index);
                    setDraggedIndex(null); setDragOverIndex(null);
                  }}
                  className={`flex flex-col relative overflow-hidden rounded-xl glass shadow-glass transition-all duration-300 hover:shadow-glass-lg ${
                    shouldHide ? "hidden" : "h-full"
                  } ${draggedIndex === index ? "opacity-30 scale-[0.98]" : ""} ${
                    dragOverIndex === index ? "border border-bee-gold/60 shadow-[0_0_12px_rgba(201,162,39,0.3)]" : ""
                  }`}
                >
                  {bee.kind === "shell" ? (
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

      {/* Mission board (toggled by the board icon in the title bar) — a local,
          token-free pipeline view of tasks / worktrees / assignments. */}
      <MissionBoard
        open={boardOpen}
        tasks={activeWorkspace?.taskCards ?? []}
        statuses={agentStatuses}
        onClose={() => setBoardOpen(false)}
      />
    </div>
  );
}
