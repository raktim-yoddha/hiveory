"use client";

import { useEffect, useState } from "react";
import TerminalPane from "./TerminalPane";
import { invoke } from "@tauri-apps/api/core";
import { useTerminalStore } from "../../stores/terminalStore";

interface ADEPanelProps {
  workingDir?: string | null;
}

export default function ADEPanel({ workingDir }: ADEPanelProps) {
  const workerBees = useTerminalStore((state) => state.workerBees);
  const removeWorkerBee = useTerminalStore((state) => state.removeWorkerBee);
  const updateWorkerBee = useTerminalStore((state) => state.updateWorkerBee);
  const maximizedPane = useTerminalStore((state) => state.maximizedPane);
  const setMaximizedPane = useTerminalStore((state) => state.setMaximizedPane);
  const gridLayout = useTerminalStore((state) => state.gridLayout);

  const [editingBee, setEditingBee] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  // Debug: confirm every WorkerBee (and therefore every grid row) is actually
  // mounted in the tree, so a missing row can be diagnosed as CSS vs. data.
  useEffect(() => {
    console.log(
      `[ADE] ${workerBees.length} WorkerBee(s) mounted, layout=${gridLayout}:`,
      workerBees.map((b) => b.id),
    );
  }, [workerBees, gridLayout]);

  const handleRemoveWorkerBee = (beeId: string) => {
    // Kill the terminal process first
    invoke("kill_terminal", { paneId: beeId })
      .then(() => {
        removeWorkerBee(beeId);
      })
      .catch((error) => {
        console.error(`Failed to kill terminal: ${beeId}`, error);
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

  const getGridColumns = () => {
    if (gridLayout !== "auto") return FIXED_COLUMN_CLASSES[gridLayout];
    const count = workerBees.length;
    if (count <= 1) return "grid-cols-1";
    if (count <= 4) return "grid-cols-2";
    return "grid-cols-4";
  };

  return (
    <div className="flex-1 flex flex-col bg-bee-canvas/40 relative">
      {/* ADE panes - Grid layout */}
      <div className="flex-1 min-h-0 p-2 overflow-y-auto">
        {workerBees.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <div className="w-14 h-14 rounded-2xl glass flex items-center justify-center text-2xl shadow-glass">
              🐝
            </div>
            <div className="text-sm text-bee-textDim">No WorkerBees running</div>
            <div className="text-xs text-bee-textMuted">
              Click <span className="text-bee-gold font-medium">Add</span> to
              launch a CLI agent
            </div>
          </div>
        ) : maximizedPane ? (
          <div className="h-full overflow-hidden rounded-xl glass shadow-glass">
            <TerminalPane
              paneId={maximizedPane}
              workingDir={workingDir}
              workerBee={workerBees.find((b) => b.id === maximizedPane)}
              onRename={
                editingBee === maximizedPane
                  ? saveRename
                  : () => startRename(maximizedPane)
              }
              isEditing={editingBee === maximizedPane}
              editValue={editValue}
              onEditChange={setEditValue}
              onCancelRename={cancelRename}
              onClose={() => handleRemoveWorkerBee(maximizedPane)}
              onToggleMaximize={() => toggleMaximize(maximizedPane)}
              isMaximized={true}
            />
          </div>
        ) : (
          <div
            className={`grid gap-2 ${getGridColumns()} min-h-full content-start`}
            style={{ gridAutoRows: "minmax(240px, 1fr)" }}
          >
            {workerBees.map((bee) => (
              <div
                key={bee.id}
                className="flex flex-col relative overflow-hidden rounded-xl glass shadow-glass"
                style={{ minHeight: "240px" }}
              >
                <TerminalPane
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
                  isMaximized={false}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
