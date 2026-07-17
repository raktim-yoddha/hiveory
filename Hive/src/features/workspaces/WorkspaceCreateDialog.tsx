"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { X, FolderOpen } from "lucide-react";
import { getTauriAPIs } from "@/shared/tauri";
import { useWorkspaceStore } from "@/features/workspaces/workspaceStore";

const WORKSPACE_COLORS = ['#c9a227', '#22c55e', '#3b82f6', '#a855f7', '#ef4444', '#06b6d4'];

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function WorkspaceCreateDialog({ open, onClose }: Props) {
  const [name, setName] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [creating, setCreating] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const addWorkspace = useWorkspaceStore((s) => s.addWorkspace);
  const workspaces = useWorkspaceStore((s) => s.workspaces);

  useEffect(() => {
    if (open) {
      setName("");
      setProjectPath("");
      setCreating(false);
      setTimeout(() => nameRef.current?.focus(), 50);
    }
  }, [open]);

  const handleBrowse = useCallback(async () => {
    try {
      const apis = getTauriAPIs();
      if (!apis?.open) return;
      const folderPath = await apis.open({ directory: true, multiple: false, title: "Select Project Folder" });
      if (folderPath && typeof folderPath === "string") {
        setProjectPath(folderPath);
      }
    } catch (e) {
      console.error("Failed to open folder picker:", e);
    }
  }, []);

  const handleCreate = useCallback(async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    const color = WORKSPACE_COLORS[workspaces.length % WORKSPACE_COLORS.length];
    addWorkspace({
      id: `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: name.trim(),
      color,
      boundProjectPath: projectPath,
      paneLayout: [],
      taskCards: [],
    });
    if (projectPath) {
      try {
        const apis = getTauriAPIs();
        if (apis?.invoke) {
          await apis.invoke("ensure_nectar_structure", { projectPath });
        }
      } catch {}
    }
    onClose();
  }, [name, projectPath, creating, workspaces.length, addWorkspace, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleCreate();
      }
      if (e.key === "Escape") {
        onClose();
      }
    },
    [handleCreate, onClose]
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={handleKeyDown}
    >
      <div
        className="w-[400px] glass-hi rounded-xl shadow-glassHi animate-scale-in overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-bee-border/50">
          <h2 className="text-sm font-semibold text-bee-text">New Workspace</h2>
          <button
            onClick={onClose}
            className="size-6 rounded-md flex items-center justify-center text-bee-textMuted hover:text-bee-text hover:bg-bee-border/40 transition-colors"
          >
            <X className="size-3.5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-3 space-y-3">
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-bee-textDim uppercase tracking-wider">
              Workspace Name
            </label>
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Implement OAuth"
              className="w-full h-8 px-2.5 rounded-md border border-bee-border/60 bg-bee-canvas/80 text-xs text-bee-text outline-none focus:border-bee-gold/60 focus:ring-[1px] focus:ring-bee-gold/20 placeholder:text-bee-textMuted/50 transition-colors"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-medium text-bee-textDim uppercase tracking-wider">
              Project Folder (optional)
            </label>
            <div className="flex items-center gap-2">
              <input
                value={projectPath}
                onChange={(e) => setProjectPath(e.target.value)}
                placeholder="Select or type a folder path"
                className="flex-1 h-8 px-2.5 rounded-md border border-bee-border/60 bg-bee-canvas/80 text-xs text-bee-text outline-none focus:border-bee-gold/60 focus:ring-[1px] focus:ring-bee-gold/20 placeholder:text-bee-textMuted/50 transition-colors truncate"
              />
              <button
                onClick={handleBrowse}
                className="size-8 rounded-md flex items-center justify-center border border-bee-border/60 text-bee-textMuted hover:text-bee-text hover:bg-bee-border/40 transition-colors"
                title="Browse for folder"
              >
                <FolderOpen className="size-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-bee-border/50 bg-bee-canvas/30">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs text-bee-textDim hover:text-bee-text hover:bg-bee-border/40 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim() || creating}
            className="px-4 py-1.5 rounded-lg text-xs font-medium bg-bee-gold/15 border border-bee-gold/25 text-bee-goldHi hover:bg-bee-gold/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {creating ? "Creating..." : "Create Workspace"}
          </button>
        </div>
      </div>
    </div>
  );
}
