"use client";

import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import TerminalPane from "./TerminalPane";
import CLIPicker, { CLIType } from "./CLIPicker";
import { invoke } from "@tauri-apps/api/core";
import { useTerminalStore, WorkerBee } from "../../stores/terminalStore";

interface ADEPanelProps {
  layout?: 1 | 2;
  workingDir?: string | null;
}

export default function ADEPanel({ workingDir }: ADEPanelProps) {
  const workerBees = useTerminalStore((state) => state.workerBees);
  const addWorkerBee = useTerminalStore((state) => state.addWorkerBee);
  const removeWorkerBee = useTerminalStore((state) => state.removeWorkerBee);
  const updateWorkerBee = useTerminalStore((state) => state.updateWorkerBee);
  const maximizedPane = useTerminalStore((state) => state.maximizedPane);
  const setMaximizedPane = useTerminalStore((state) => state.setMaximizedPane);
  
  const [showCLIPicker, setShowCLIPicker] = useState(false);
  const [pickerPosition, setPickerPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [editingBee, setEditingBee] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const addButtonRef = useRef<HTMLButtonElement>(null);


  // Debug: confirm every WorkerBee (and therefore every grid row) is actually
  // mounted in the tree, so a missing row can be diagnosed as CSS vs. data.
  useEffect(() => {
    const cols = maximizedPane ? 1 : workerBees.length <= 2 ? workerBees.length || 1 : workerBees.length <= 4 ? 2 : 4;
    const rows = Math.max(1, Math.ceil(workerBees.length / (cols || 1)));
    console.log(
      `[ADE] ${workerBees.length} WorkerBee(s) mounted across ${rows} row(s):`,
      workerBees.map((b) => b.id),
    );
  }, [workerBees, maximizedPane]);

  const handleAddButtonClick = () => {
    if (addButtonRef.current) {
      const rect = addButtonRef.current.getBoundingClientRect();
      setPickerPosition({ x: rect.left, y: rect.bottom + 4 });
    }
    setShowCLIPicker(true);
  };

  const handleCLISelect = (cli: CLIType) => {
    const cliNames: Record<CLIType, string> = {
      "claude-code": "Claude Code",
      "codex-cli": "Codex CLI",
      aider: "Aider",
      "gemini-cli": "Gemini CLI",
      antigravity: "Antigravity",
      "open-code": "OpenCode",
      "kimi-code": "Kimi Code",
      cline: "Cline",
      cursor: "Cursor",
      windsurf: "Windsurf",
    };

    const newWorkerBee: WorkerBee = {
      id: `workerbee-${Date.now()}`,
      cli,
      cliName: cliNames[cli],
    };

    addWorkerBee(newWorkerBee);
  };

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
    const bee = workerBees.find(b => b.id === beeId);
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

  const getGridColumns = () => {
    const count = workerBees.length;
    if (count === 0) return "grid-cols-1";
    if (count === 1) return "grid-cols-1";
    if (count === 2) return "grid-cols-2";
    if (count <= 4) return "grid-cols-2";
    if (count <= 8) return "grid-cols-4";
    return "grid-cols-4";
  };

  return (
    <div className="flex-1 flex flex-col bg-bee-canvas/40 relative">
      {/* ADE toolbar */}
      <div className="h-9 glass-toolbar border-b border-bee-border/60 flex items-center justify-between px-3">
        <div className="flex items-center gap-2.5">
          <span className="text-xs font-semibold tracking-wide text-bee-text">
            WorkerBees
          </span>
          <span className="text-[11px] font-medium text-bee-gold bg-bee-gold/10 border border-bee-gold/20 px-2 py-0.5 rounded-full">
            {workerBees.length}/16
          </span>
        </div>

        <button
          ref={addButtonRef}
          onClick={handleAddButtonClick}
          disabled={workerBees.length >= 16}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs bg-bee-gold/10 border border-bee-gold/20 text-bee-goldHi hover:bg-bee-gold/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title="Add new WorkerBee"
        >
          <Plus size={13} />
          Add
        </button>
      </div>

      {/* CLI Picker */}
      {showCLIPicker && pickerPosition && (
        <CLIPicker
          position={pickerPosition}
          onSelect={handleCLISelect}
          onClose={() => setShowCLIPicker(false)}
        />
      )}

      {/* ADE panes - Grid layout */}
      <div className="flex-1 min-h-0 p-2 overflow-y-auto">
        {workerBees.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <div className="w-14 h-14 rounded-2xl glass flex items-center justify-center text-2xl shadow-glass">
              🐝
            </div>
            <div className="text-sm text-bee-textDim">No WorkerBees running</div>
            <div className="text-xs text-bee-textMuted">
              Click{" "}
              <span className="text-bee-gold font-medium">Add</span> to launch a
              CLI agent
            </div>
          </div>
        ) : maximizedPane ? (
          <div className="h-full overflow-hidden rounded-xl glass shadow-glass">
            <TerminalPane
              paneId={maximizedPane}
              workingDir={workingDir}
              workerBee={workerBees.find((b) => b.id === maximizedPane)}
              onRename={editingBee === maximizedPane ? saveRename : () => startRename(maximizedPane)}
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
                  onRename={editingBee === bee.id ? saveRename : () => startRename(bee.id)}
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
