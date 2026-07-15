"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Search, X, ChevronRight, Bot, Hexagon } from "lucide-react";
import { useWorkspaceStore, type Workspace } from "@/stores/workspaceStore";
import { useWorkerBeesStore, type AgentStatus } from "@/stores/workerBeesStore";

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

export default function ADEWorktreeSidebar() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const activateAndSync = useWorkspaceStore((s) => s.activateWorkspaceAndSync);
  const workerBees = useWorkerBeesStore((s) => s.workerBees);
  const agentStatuses = useWorkerBeesStore((s) => s.agentStatuses);

  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [isResizing, setIsResizing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<Set<string>>(() => new Set());
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

  const filteredWorkspaces = workspaces.filter((ws) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      ws.name.toLowerCase().includes(q) ||
      ws.paneLayout.some((b) => b.customName?.toLowerCase().includes(q) || b.cliName.toLowerCase().includes(q))
    );
  });

  const toggleCollapse = (wsId: string) => {
    setCollapsedWorkspaces((prev) => {
      const next = new Set(prev);
      if (next.has(wsId)) next.delete(wsId);
      else next.add(wsId);
      return next;
    });
  };

  return (
    <div
      ref={sidebarRef}
      className="relative h-full flex flex-col bg-bee-surface/70 backdrop-blur-md border-r border-bee-border/50 overflow-hidden shrink-0"
      style={{ width: sidebarWidth }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-bee-border/40">
        <span className="text-xs font-semibold text-bee-gold uppercase tracking-wider">
          Workspaces
        </span>
        <span className="text-[10px] font-medium text-bee-textMuted bg-bee-border/20 px-1.5 py-0.5 rounded-full">
          {workspaces.length}
        </span>
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

      {/* Workspace list */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-sleek">
        {filteredWorkspaces.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-4 text-center">
            <Hexagon className="size-6 mb-2 text-bee-textMuted/50" />
            <p className="text-[11px] text-bee-textMuted">
              {searchQuery ? "No matching workspaces" : "No workspaces yet"}
            </p>
          </div>
        ) : (
          filteredWorkspaces.map((ws) => {
            const isActive = ws.id === activeWorkspaceId;
            const isCollapsed = collapsedWorkspaces.has(ws.id);
            const hasActive = hasActiveAgent(ws, agentStatuses);

            return (
              <div key={ws.id} className="border-b border-bee-border/20 last:border-b-0">
                {/* Workspace group header */}
                <button
                  onClick={() => toggleCollapse(ws.id)}
                  className="flex items-center w-full h-8 gap-1.5 px-3 text-left text-[11px] font-semibold text-bee-textDim hover:text-bee-text hover:bg-bee-border/20 transition-colors"
                >
                  <ChevronRight
                    className={`size-3 shrink-0 transition-transform ${!isCollapsed ? "rotate-90" : ""}`}
                  />
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: ws.color }}
                  />
                  <span className="min-w-0 flex-1 truncate">{ws.name}</span>
                  <span className="rounded border border-bee-border/40 bg-bee-border/20 px-1.5 py-0.5 text-[9px] font-medium tabular-nums leading-none text-bee-textMuted">
                    {ws.paneLayout.length}
                  </span>
                </button>

                {/* Worktree/mission rows */}
                {!isCollapsed && (
                  <div className="pb-1">
                    {/* Main worktree row for this workspace */}
                    <div
                      onClick={() => activateAndSync(ws.id)}
                      className={`group flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-all mx-1 rounded-md ${
                        isActive
                          ? "bg-bee-gold/8 text-bee-goldHi"
                          : "text-bee-textDim hover:text-bee-text hover:bg-bee-border/25"
                      }`}
                    >
                      {/* Status dot */}
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 transition-colors ${
                          hasActive ? STATUS_DOT_CLASS.running : "bg-bee-textMuted/40"
                        }`}
                        title={hasActive ? "Has active agent" : "Sleeping"}
                      />

                      {/* Icon */}
                      <Bot className="size-3.5 shrink-0 text-bee-textMuted/60" />

                      {/* Content */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium truncate">{ws.name}</span>
                          {isActive && (
                            <span className="text-[9px] font-medium text-bee-goldHi bg-bee-gold/10 border border-bee-gold/20 px-1.5 py-0 rounded-[3px] flex-shrink-0">
                              primary
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-bee-textMuted/70">
                          <span className="truncate">
                            {activeAgentCount(ws, agentStatuses) > 0
                              ? `${activeAgentCount(ws, agentStatuses)} agent(s) active`
                              : "No active agents"}
                          </span>
                          {ws.taskCards.length > 0 && (
                            <>
                              <span className="w-0.5 h-0.5 rounded-full bg-bee-textMuted/30" />
                              <span>{ws.taskCards.length} tasks</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Individual worktree/mission items */}
                    {ws.paneLayout.map((bee) => {
                      const beeStatus = agentStatuses[bee.id] || "idle";
                      return (
                        <div
                          key={bee.id}
                          className={`flex items-center gap-2 px-3 py-1 cursor-pointer transition-all mx-2 rounded-sm ${
                            isActive
                              ? "text-bee-textDim hover:text-bee-text hover:bg-bee-border/20"
                              : "text-bee-textMuted hover:text-bee-textDim hover:bg-bee-border/15"
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT_CLASS[beeStatus] || "bg-bee-textMuted/40"}`}
                          />
                          <span className="text-[11px] truncate flex-1">
                            {bee.customName || bee.cliName}
                          </span>
                          <span className="text-[9px] text-bee-textMuted/50">{bee.cliName}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Resize handle — extends beyond sidebar for easier grabbing (Orca-inspired) */}
      <div
        className="absolute -right-1.5 top-0 z-10 flex h-full w-3 cursor-col-resize items-stretch justify-center group"
        onMouseDown={handleResizeStart}
      >
        <div className="h-full w-px bg-bee-border/40 transition-colors group-hover:bg-bee-gold/60 group-active:bg-bee-gold" />
      </div>
    </div>
  );
}
