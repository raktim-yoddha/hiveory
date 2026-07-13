"use client";

import { X, Plus, Pin, PinOff } from "lucide-react";
import { useWorkspaceStore } from "@/stores/workspaceStore";

interface WorkspacesPanelProps {
  onClose: () => void;
  docked?: boolean;
  onToggleDock?: () => void;
}

export default function WorkspacesPanel({ onClose, docked, onToggleDock }: WorkspacesPanelProps) {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace);
  const addWorkspace = useWorkspaceStore((s) => s.addWorkspace);
  const removeWorkspace = useWorkspaceStore((s) => s.removeWorkspace);

  const handleAdd = () => {
    const colors = ['#c9a227', '#22c55e', '#3b82f6', '#a855f7', '#ef4444', '#06b6d4'];
    const ws = {
      id: `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: `Workspace ${workspaces.length + 1}`,
      color: colors[Math.floor(Math.random() * colors.length)],
      boundProjectPath: "",
      paneLayout: [],
    };
    addWorkspace(ws);
  };

  return (
    <div
      className="h-full glass-hi border-r border-bee-border/60 flex flex-col overflow-hidden animate-fade-in"
      style={{ width: "280px", minWidth: "280px" }}
    >
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-bee-border/50">
        <span className="text-xs font-semibold text-bee-gold uppercase tracking-wider">Workspaces</span>
        <div className="flex items-center gap-1">
          <button
            onClick={onToggleDock}
            className="p-1 rounded-md hover:bg-bee-border/60 text-bee-textMuted hover:text-bee-text transition-colors"
            title={docked ? "Switch to floating overlay" : "Dock to side"}
          >
            {docked ? <PinOff size={13} /> : <Pin size={13} />}
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-bee-border/60 text-bee-textMuted hover:text-bee-text transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {workspaces.map((ws) => {
          const isActive = ws.id === activeWorkspaceId;
          return (
            <div
              key={ws.id}
              onClick={() => { setActiveWorkspace(ws.id); if (!docked) onClose(); }}
              className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs cursor-pointer transition-all ${
                isActive
                  ? "bg-bee-gold/10 text-bee-goldHi"
                  : "text-bee-textDim hover:text-bee-text hover:bg-bee-border/40"
              }`}
            >
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: ws.color }}
              />
              <span className="truncate flex-1">{ws.name}</span>
              {workspaces.length > 1 && (
                <button
                  onClick={(e) => { e.stopPropagation(); removeWorkspace(ws.id); }}
                  className="p-0.5 rounded opacity-0 hover:opacity-100 hover:bg-bee-err/25 text-bee-textMuted hover:text-bee-err transition-all"
                >
                  <X size={11} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="p-2 border-t border-bee-border/50">
        <button
          onClick={handleAdd}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-bee-gold/10 border border-bee-gold/20 text-bee-goldHi hover:bg-bee-gold/20 transition-colors"
        >
          <Plus size={12} />
          New Workspace
        </button>
      </div>
    </div>
  );
}
