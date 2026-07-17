"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  Search,
  X,
  Bot,
  Hexagon,
  GitBranch,
  Plus,
  Trash2,
  LoaderCircle,
  Eye,
  EyeOff,
  MoreHorizontal,
  Pin,
  PinOff,
} from "lucide-react";
import { useWorkspaceStore, type Workspace } from "@/features/workspaces/workspaceStore";
import { useWorkerBeesStore, type AgentStatus } from "@/features/worker-bees/workerBeesStore";
import WorkspaceCreateDialog from "@/features/workspaces/WorkspaceCreateDialog";

const MIN_WIDTH = 220;
const MAX_WIDTH = 500;

const STATUS_DOT_CLASS: Record<AgentStatus, string> = {
  launching: "bg-yellow-400",
  running: "bg-green-400",
  idle: "bg-bee-textMuted",
  error: "bg-red-400",
  done: "bg-bee-gold",
};

function hasActiveAgent(ws: Workspace, statuses: Record<string, AgentStatus>): boolean {
  return ws.paneLayout.some((b) => statuses[b.id] === "running" || statuses[b.id] === "launching");
}

function activeAgentCount(ws: Workspace, statuses: Record<string, AgentStatus>): number {
  return ws.paneLayout.filter((b) => statuses[b.id] === "running" || statuses[b.id] === "launching").length;
}

const WORKSPACE_COLORS = ['#c9a227', '#22c55e', '#3b82f6', '#a855f7', '#ef4444', '#06b6d4'];

interface Props {
  pinned?: boolean;
  onTogglePin?: () => void;
  onClose?: () => void;
}

export default function ADEWorktreeSidebar({ pinned = true, onTogglePin, onClose }: Props) {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const activateAndSync = useWorkspaceStore((s) => s.activateWorkspaceAndSync);
  const updateWorkspace = useWorkspaceStore((s) => s.updateWorkspace);
  const renameWorkspace = useWorkspaceStore((s) => s.renameWorkspace);
  const deleteWorkspace = useWorkspaceStore((s) => s.deleteWorkspace);
  const commitDeleteWorkspace = useWorkspaceStore((s) => s.commitDeleteWorkspace);
  const cancelDeleteWorkspace = useWorkspaceStore((s) => s.cancelDeleteWorkspace);
  const renamingWorkspaceId = useWorkspaceStore((s) => s.renamingWorkspaceId);
  const setRenamingWorkspaceId = useWorkspaceStore((s) => s.setRenamingWorkspaceId);
  const agentStatuses = useWorkerBeesStore((s) => s.agentStatuses);

  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [isResizing, setIsResizing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [hideSleeping, setHideSleeping] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [contextMenu, setContextMenu] = useState<{ ws: Workspace; x: number; y: number } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;
    const handleMouseMove = (e: MouseEvent) => {
      if (!sidebarRef.current) return;
      const rect = sidebarRef.current.getBoundingClientRect();
      let newWidth = e.clientX - rect.left;
      newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, newWidth));
      setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => setIsResizing(false);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [contextMenu]);

  const visibleWorkspaces = workspaces.filter((ws) => {
    if (hideSleeping && !hasActiveAgent(ws, agentStatuses) && ws.paneLayout.length === 0) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return ws.name.toLowerCase().includes(q);
  });

  const handleAdd = () => {
    setCreateDialogOpen(true);
  };

  const startRename = (id: string, currentName: string) => {
    setRenamingWorkspaceId(id);
    setEditValue(currentName);
  };

  const commitRename = () => {
    if (renamingWorkspaceId && editValue.trim()) {
      renameWorkspace(renamingWorkspaceId, editValue.trim());
    }
    setRenamingWorkspaceId(null);
    setEditValue("");
  };

  const handleContextMenu = (e: React.MouseEvent, ws: Workspace) => {
    e.preventDefault();
    setContextMenu({ ws, x: e.clientX, y: e.clientY });
  };

  return (
    <div
      ref={sidebarRef}
      // No overflow-hidden here: it clipped the -right-1.5 resize handle, so the
      // sidebar could never actually be dragged. Inner lists clip themselves.
      className="relative h-full flex flex-col bg-bee-surface/70 backdrop-blur-md border-r border-bee-border/50 shrink-0"
      style={{ width: sidebarWidth }}
    >
      {/* Header — title + filter + add + close + pin */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-bee-border/40">
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            onClick={onClose}
            className="size-5 rounded flex items-center justify-center text-bee-textMuted hover:text-bee-text hover:bg-bee-border/40 transition-colors"
            title="Close sidebar"
          >
            <X className="size-3" />
          </button>
          <span className="text-xs font-semibold text-bee-gold uppercase tracking-wider">
            Workspaces
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setHideSleeping(!hideSleeping)}
            className={`size-5 rounded flex items-center justify-center transition-colors ${
              hideSleeping ? "text-bee-goldHi bg-bee-gold/10" : "text-bee-textMuted hover:text-bee-text hover:bg-bee-border/40"
            }`}
            title={hideSleeping ? "Show sleeping" : "Hide sleeping"}
          >
            {hideSleeping ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
          </button>
          <span className="text-[10px] font-medium text-bee-textMuted bg-bee-border/20 px-1.5 py-0.5 rounded-full">
            {visibleWorkspaces.length}
          </span>
          <button
            onClick={handleAdd}
            className="size-5 rounded flex items-center justify-center text-bee-textMuted hover:text-bee-text hover:bg-bee-border/40 transition-colors"
            title="New workspace"
          >
            <Plus className="size-3" />
          </button>
          <button
            onClick={onTogglePin}
            className={`size-5 rounded flex items-center justify-center transition-colors ${
              pinned ? "text-bee-goldHi/70" : "text-bee-textMuted hover:text-bee-textDim"
            }`}
            title={pinned ? "Unpin sidebar" : "Pin sidebar"}
          >
            {pinned ? <PinOff size={12} /> : <Pin size={12} />}
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="px-2 py-1.5">
        <div className="flex h-7 items-center gap-1.5 rounded-md border border-bee-border/50 bg-bee-canvas/60 px-2 focus-within:border-bee-gold/40 focus-within:ring-[1px] focus-within:ring-bee-gold/20">
          <Search className="size-3 shrink-0 text-bee-textMuted" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter workspaces..."
            className="min-w-0 flex-1 bg-transparent py-1 text-[11px] text-bee-text outline-none placeholder:text-bee-textMuted/50"
            spellCheck={false}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="size-4 rounded flex items-center justify-center text-bee-textMuted hover:text-bee-text"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      </div>

      {/* Flat workspace list — one row per workspace */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-sleek">
        {visibleWorkspaces.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-4 text-center">
            <Hexagon className="size-6 mb-2 text-bee-textMuted/50" />
            <p className="text-[11px] text-bee-textMuted">
              {searchQuery ? "No matching workspaces" : hideSleeping ? "All workspaces sleeping" : "No workspaces yet"}
            </p>
          </div>
        ) : (
          visibleWorkspaces.map((ws) => {
            const isActive = ws.id === activeWorkspaceId;
            const isFirst = ws === workspaces[0];
            const hasActive = hasActiveAgent(ws, agentStatuses);
            const activeCount = activeAgentCount(ws, agentStatuses);
            const isDeleting = ws.isDeleting;
            const isRenaming = renamingWorkspaceId === ws.id;

            return (
              <div
                key={ws.id}
                className="relative"
                onContextMenu={(e) => handleContextMenu(e, ws)}
              >
                {/* Main row — workspace card with visual states */}
                <div
                  onClick={() => { if (!isDeleting) activateAndSync(ws.id); }}
                  className={`group flex items-center gap-2.5 px-3 py-2.5 cursor-pointer transition-all border-b border-bee-border/10 last:border-b-0 ${
                    isDeleting
                      ? "opacity-50 grayscale cursor-not-allowed"
                      : isActive
                        ? "bg-bee-gold/[0.06] text-bee-goldHi border-l-2 border-l-bee-gold"
                        : "text-bee-textDim hover:text-bee-text hover:bg-bee-border/20 hover:border-l-2 hover:border-l-bee-border/30"
                  }`}
                >
                  {/* Status dot — green/amber/grey */}
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 transition-colors ${
                      isDeleting
                        ? "bg-bee-textMuted/20"
                        : hasActive
                          ? STATUS_DOT_CLASS.running
                          : "bg-bee-textMuted/35"
                    }`}
                    title={
                      isDeleting ? "Deleting..."
                      : hasActive ? `${activeCount} agent(s) active`
                      : "Sleeping"
                    }
                  />

                  {/* Color dot */}
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: ws.color }}
                  />

                  {/* Content — title + meta row */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {isRenaming ? (
                        <input
                          autoFocus
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={commitRename}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitRename();
                            if (e.key === "Escape") { setRenamingWorkspaceId(null); setEditValue(""); }
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="flex-1 bg-transparent border-b border-bee-gold/40 text-xs text-bee-text outline-none min-w-0"
                        />
                      ) : (
                        <span
                          className="text-xs font-medium truncate"
                          onDoubleClick={(e) => { e.stopPropagation(); startRename(ws.id, ws.name); }}
                        >
                          {ws.name}
                        </span>
                      )}
                      {isActive && !isDeleting && (
                        <span className="text-[9px] font-medium text-bee-goldHi bg-bee-gold/10 border border-bee-gold/20 px-1.5 py-0 rounded-[3px] flex-shrink-0">
                          primary
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-bee-textMuted/70 mt-0.5">
                      <GitBranch className="size-2.5 shrink-0" />
                      <span className="truncate">
                        {ws.boundProjectPath
                          ? ws.boundProjectPath.split(/[\\/]/).filter(Boolean).pop()
                          : "no repo"}
                      </span>
                      {activeCount > 0 && (
                        <>
                          <span className="w-0.5 h-0.5 rounded-full bg-bee-textMuted/30" />
                          <Bot className="size-2.5 shrink-0" />
                          <span>{activeCount}</span>
                        </>
                      )}
                      {ws.taskCards.length > 0 && (
                        <>
                          <span className="w-0.5 h-0.5 rounded-full bg-bee-textMuted/30" />
                          <span>{ws.taskCards.length} tasks</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Actions — show on hover */}
                  <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteWorkspace(ws.id); }}
                      className="size-5 rounded flex items-center justify-center text-bee-textMuted hover:text-bee-err hover:bg-bee-err/15 transition-colors"
                      title="Delete workspace"
                    >
                      <Trash2 className="size-3" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setContextMenu({ ws, x: e.clientX, y: e.clientY }); }}
                      className="size-5 rounded flex items-center justify-center text-bee-textMuted hover:text-bee-text hover:bg-bee-border/40 transition-colors"
                    >
                      <MoreHorizontal className="size-3" />
                    </button>
                  </div>
                </div>

                {/* Delete overlay — two-step confirm */}
                {isDeleting && (
                  <div className="absolute inset-x-1 inset-y-0 z-10 flex items-center justify-center rounded-md bg-bee-surface/80 backdrop-blur-[1px]">
                    <div className="inline-flex items-center gap-2 rounded-full bg-bee-surfaceHi border border-bee-border/60 px-3 py-1 text-[11px] font-medium text-bee-text shadow-sm">
                      <LoaderCircle className="size-3 animate-spin text-bee-textMuted" />
                      <span>Queued for deletion</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); cancelDeleteWorkspace(ws.id); }}
                        className="ml-1 text-bee-textMuted hover:text-bee-text transition-colors"
                      >
                        <X className="size-3" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); commitDeleteWorkspace(ws.id); }}
                        className="text-bee-err hover:text-red-300 transition-colors font-semibold"
                      >
                        Confirm
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-40 py-1 rounded-lg glass-hi animate-fade-in shadow-glassHi"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={() => setContextMenu(null)}
        >
          <button
            onClick={() => { startRename(contextMenu.ws.id, contextMenu.ws.name); setContextMenu(null); }}
            className="w-full px-3 py-1.5 text-left text-xs text-bee-textDim hover:text-bee-text hover:bg-bee-gold/10 transition-colors"
          >
            Rename
          </button>
          <button
            onClick={() => {
              const colors = WORKSPACE_COLORS;
              const nextColor = colors[(colors.indexOf(contextMenu.ws.color) + 1) % colors.length];
              updateWorkspace(contextMenu.ws.id, { color: nextColor });
              setContextMenu(null);
            }}
            className="w-full px-3 py-1.5 text-left text-xs text-bee-textDim hover:text-bee-text hover:bg-bee-gold/10 transition-colors"
          >
            Cycle color
          </button>
          <div className="h-px bg-bee-border/40 my-1 mx-2" />
          <button
            onClick={() => { deleteWorkspace(contextMenu.ws.id); setContextMenu(null); }}
            className="w-full px-3 py-1.5 text-left text-xs text-bee-err hover:bg-bee-err/15 transition-colors"
          >
            Delete
          </button>
        </div>
      )}

      {/* Resize handle — extends beyond sidebar */}
      <div
        className="absolute -right-2 top-0 z-40 flex h-full w-4 cursor-col-resize items-stretch justify-center group select-none"
        onMouseDown={handleResizeStart}
      >
        <div className="h-full w-px bg-bee-border/40 transition-colors group-hover:bg-bee-gold/60 group-active:bg-bee-gold" />
      </div>

      {/* Workspace creation dialog */}
      <WorkspaceCreateDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
      />
    </div>
  );
}
