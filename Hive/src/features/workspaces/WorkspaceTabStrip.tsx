"use client";

import { useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { useWorkspaceStore } from "@/features/workspaces/workspaceStore";
import { useWorkerBeesStore } from "@/features/worker-bees/workerBeesStore";

function randomColor() {
  const colors = ['#c9a227', '#22c55e', '#3b82f6', '#a855f7', '#ef4444', '#06b6d4', '#ec4899', '#f97316'];
  return colors[Math.floor(Math.random() * colors.length)];
}

function nextId() {
  return `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function WorkspaceTabStrip() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const addWorkspace = useWorkspaceStore((s) => s.addWorkspace);
  const removeWorkspace = useWorkspaceStore((s) => s.removeWorkspace);
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace);
  const renameWorkspace = useWorkspaceStore((s) => s.renameWorkspace);

  const workerBees = useWorkerBeesStore((s) => s.workerBees);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const activeWs = workspaces.find((w) => w.id === activeWorkspaceId);

  const handleAdd = () => {
    const ws = {
      id: nextId(),
      name: `Workspace ${workspaces.length + 1}`,
      color: randomColor(),
      boundProjectPath: "",
      paneLayout: [],
      taskCards: [],
    };
    addWorkspace(ws);
  };

  const handleRemove = (id: string) => {
    const ws = workspaces.find((w) => w.id === id);
    if (ws && ws.paneLayout.length > 0) {
      const ok = confirm(`"${ws.name}" has running agents. Are you sure?`);
      if (!ok) return;
    }
    removeWorkspace(id);
  };

  const startRename = (id: string, name: string) => {
    setEditingId(id);
    setEditValue(name);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const saveRename = (id: string) => {
    if (editValue.trim()) {
      renameWorkspace(id, editValue.trim());
    }
    setEditingId(null);
  };

  return (
    <div className="glass-toolbar border-b border-bee-border/60 flex items-center h-9 px-2 gap-0.5 overflow-x-auto no-scrollbar flex-shrink-0">
      {workspaces.map((ws) => {
        const isActive = ws.id === activeWorkspaceId;
        return (
          <div
            key={ws.id}
            onClick={() => setActiveWorkspace(ws.id)}
            className={`group relative flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs cursor-pointer transition-all select-none whitespace-nowrap min-w-0 ${
              isActive
                ? "bg-bee-gold/10 text-bee-goldHi shadow-[inset_0_-1px_0_#c9a227]"
                : "text-bee-textDim hover:text-bee-text hover:bg-bee-border/40"
            }`}
          >
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: ws.color }}
            />
            {editingId === ws.id ? (
              <input
                ref={inputRef}
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={() => saveRename(ws.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveRename(ws.id);
                  if (e.key === "Escape") setEditingId(null);
                }}
                onClick={(e) => e.stopPropagation()}
                className="bg-bee-canvas text-bee-text px-1.5 py-0.5 rounded text-xs w-24 outline-none focus:ring-1 focus:ring-bee-gold border border-bee-border"
                autoFocus
              />
            ) : (
              <span
                className="truncate max-w-[100px]"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  startRename(ws.id, ws.name);
                }}
              >
                {ws.name}
              </span>
            )}
            {ws.paneLayout.length > 0 && (
              <span className="text-[9px] text-bee-textMuted font-mono">({ws.paneLayout.length})</span>
            )}
            {workspaces.length > 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemove(ws.id);
                }}
                className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-bee-err/25 text-bee-textMuted hover:text-bee-err transition-all ml-0.5"
              >
                <X size={11} />
              </button>
            )}
          </div>
        );
      })}

      <button
        onClick={handleAdd}
        className="p-1.5 rounded-lg text-bee-textMuted hover:text-bee-goldHi hover:bg-bee-gold/10 transition-colors flex-shrink-0 ml-0.5"
        title="New workspace"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
