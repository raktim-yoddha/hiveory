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
  Folder,
  FolderOpen,
  File,
  FileCode,
  FileText,
  FileCog,
  Braces,
  Hash,
  ChevronRight,
  ChevronDown,
  ArrowLeft,
  type LucideIcon,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useWorkspaceStore, type Workspace } from "@/features/workspaces/workspaceStore";
import { useWorkerBeesStore, type AgentStatus } from "@/features/worker-bees/workerBeesStore";
import WorkspaceCreateDialog from "@/features/workspaces/WorkspaceCreateDialog";

const MIN_WIDTH = 220;
const MAX_WIDTH = 500;

type LeftTab = "workspaces" | "explorer" | "search";

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

const WORKSPACE_COLORS = ["#c9a227", "#22c55e", "#3b82f6", "#a855f7", "#ef4444", "#06b6d4"];

interface Props {
  projectPath?: string | null;
  pinned?: boolean;
  onTogglePin?: () => void;
  onClose?: () => void;
}

interface ViewerTarget {
  path: string;
  line?: number;
  diff?: boolean;
  projectPath?: string | null;
}

interface FileNode {
  name: string;
  path: string;
  is_file: boolean;
  is_dir: boolean;
  children?: FileNode[];
  expanded?: boolean;
}

function getFileIcon(filename: string): { Icon: LucideIcon; className: string } {
  const ext = filename.split(".").pop()?.toLowerCase();
  const map: Record<string, { Icon: LucideIcon; className: string }> = {
    ts: { Icon: FileCode, className: "text-bee-gold" },
    tsx: { Icon: FileCode, className: "text-bee-goldHi" },
    js: { Icon: FileCode, className: "text-bee-honey" },
    jsx: { Icon: FileCode, className: "text-bee-goldHi" },
    rs: { Icon: FileCode, className: "text-bee-err" },
    json: { Icon: Braces, className: "text-bee-amber" },
    md: { Icon: FileText, className: "text-bee-textDim" },
    css: { Icon: Hash, className: "text-bee-gold" },
    scss: { Icon: Hash, className: "text-bee-gold" },
    html: { Icon: FileCode, className: "text-bee-warn" },
    toml: { Icon: FileCog, className: "text-bee-textMuted" },
    yaml: { Icon: FileCog, className: "text-bee-textMuted" },
    yml: { Icon: FileCog, className: "text-bee-textMuted" },
  };
  return map[ext || ""] || { Icon: File, className: "text-bee-textMuted" };
}

function FileViewer({ target, onBack }: { target: ViewerTarget; onBack: () => void }) {
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const text = target.diff && target.projectPath
          ? await invoke<string>("run_command", {
              command: "git",
              args: ["-C", target.projectPath, "diff", "--", target.path],
            })
          : await invoke<string>("read_file", { path: target.path });
        if (!cancelled) setContent(text);
      } catch (e: any) {
        if (!cancelled) setError(String(e?.message ?? e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [target.path, target.diff, target.projectPath]);

  useEffect(() => {
    if (!loading && target.line) {
      lineRef.current?.scrollIntoView({ block: "center" });
    }
  }, [loading, target.line]);

  const name = target.path.split(/[\\/]/).pop();
  const lines = content.split("\n");

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1.5 border-b border-bee-border/30 px-2 py-1.5">
        <button
          onClick={onBack}
          className="flex size-5 shrink-0 items-center justify-center rounded text-bee-textMuted transition-colors hover:bg-bee-border/40 hover:text-bee-text"
          title="Back"
        >
          <ArrowLeft className="size-3" />
        </button>
        <span className="truncate text-[11px] font-medium text-bee-text" title={target.path}>
          {name}
        </span>
      </div>

      <div className="flex-1 overflow-auto scrollbar-sleek">
        {loading ? (
          <div className="px-3 py-2 text-[11px] text-bee-textMuted">Loading…</div>
        ) : error ? (
          <div className="px-3 py-2 text-[11px] text-bee-err">{error}</div>
        ) : content.trim() === "" ? (
          <div className="px-3 py-2 text-[11px] text-bee-textMuted">Empty file</div>
        ) : (
          <pre className="py-1 font-mono text-[10px] leading-[1.5]">
            {lines.map((l, i) => {
              const n = i + 1;
              const hit = target.line === n;
              return (
                <div
                  key={i}
                  ref={hit ? lineRef : undefined}
                  className={`flex gap-2 px-2 ${hit ? "bg-bee-gold/10" : ""}`}
                >
                  <span className="w-7 shrink-0 select-none text-right text-bee-textMuted/50">
                    {n}
                  </span>
                  <span className="whitespace-pre-wrap break-all text-bee-textDim">{l || " "}</span>
                </div>
              );
            })}
          </pre>
        )}
      </div>
    </div>
  );
}

function ExplorerPanel({
  projectPath,
  onOpen,
}: {
  projectPath: string | null;
  onOpen: (t: ViewerTarget) => void;
}) {
  const [tree, setTree] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectPath) return;
    loadDir(projectPath).then(setTree).finally(() => setLoading(false));
  }, [projectPath]);

  async function loadDir(path: string): Promise<FileNode[]> {
    try {
      const files = await invoke<any[]>("list_directory", { path });
      return files.map((f: any) => ({
        name: f.name,
        path: f.path,
        is_file: f.is_file,
        is_dir: f.is_dir,
        children: f.is_dir ? [] : undefined,
        expanded: false,
      }));
    } catch {
      return [];
    }
  }

  async function toggleExpand(node: FileNode) {
    if (!node.is_dir) return;
    if (!node.expanded && (!node.children || node.children.length === 0)) {
      const children = await loadDir(node.path);
      node.children = children;
    }
    node.expanded = !node.expanded;
    setTree([...tree]);
  }

  function renderNodes(nodes: FileNode[], level = 0) {
    return nodes.map((node) => {
      const { Icon, className } = getFileIcon(node.name);
      return (
        <div key={node.path}>
          <div
            className="group flex items-center gap-1.5 px-2 py-1 text-[12px] cursor-pointer rounded-md text-bee-textDim hover:bg-bee-gold/10 hover:text-bee-text transition-colors"
            style={{ paddingLeft: `${level * 12 + 8}px` }}
            onClick={() => {
              if (node.is_dir) toggleExpand(node);
              else onOpen({ path: node.path });
            }}
          >
            {node.is_dir ? (
              <>
                {node.expanded ? (
                  <ChevronDown size={13} className="text-bee-textMuted flex-shrink-0" />
                ) : (
                  <ChevronRight size={13} className="text-bee-textMuted flex-shrink-0" />
                )}
                {node.expanded ? (
                  <FolderOpen size={14} className="text-bee-gold flex-shrink-0" />
                ) : (
                  <Folder size={14} className="text-bee-gold flex-shrink-0" />
                )}
              </>
            ) : (
              <>
                <span className="w-[13px] flex-shrink-0" />
                <Icon size={14} className={`${className} flex-shrink-0`} />
              </>
            )}
            <span className="ml-0.5 truncate">{node.name}</span>
          </div>
          {node.expanded && node.children && renderNodes(node.children, level + 1)}
        </div>
      );
    });
  }

  if (!projectPath) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-4 text-center text-bee-textMuted">
        <FolderOpen className="size-6 mb-2 opacity-50 text-bee-gold" />
        <p className="text-xs font-medium">No project open</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden scrollbar-sleek">
      {loading ? (
        <div className="px-3 py-2 text-[12px] text-bee-textMuted">Loading…</div>
      ) : tree.length === 0 ? (
        <div className="px-3 py-2 text-[12px] text-bee-textMuted">No files</div>
      ) : (
        <div className="py-1.5">{renderNodes(tree)}</div>
      )}
    </div>
  );
}

function SearchPanel({
  projectPath,
  onOpen,
}: {
  projectPath: string | null;
  onOpen: (t: ViewerTarget) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ path: string; line: number; text: string }[]>([]);
  const [searching, setSearching] = useState(false);

  const handleSearch = async () => {
    if (!query.trim() || !projectPath) return;
    setSearching(true);
    try {
      const apis = await import("@/shared/tauri").then((m) => m.getTauriAPIs());
      if (!apis?.invoke) return;
      const grep = await apis.invoke<string>("run_command", {
        command: "rg",
        args: ["--no-heading", "--line-number", query, projectPath],
      });
      const lines = grep.split("\n").filter(Boolean).slice(0, 100);
      setResults(
        lines.flatMap((l) => {
          const m = l.match(/^(.*?):(\d+):([\s\S]*)$/);
          return m ? [{ path: m[1], line: parseInt(m[2], 10), text: m[3] }] : [];
        })
      );
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-2 border-b border-bee-border/30">
        <div className="flex h-7 items-center gap-1.5 rounded-md border border-bee-border/50 bg-bee-canvas/60 px-2 focus-within:border-bee-gold/40">
          <Search className="size-3 shrink-0 text-bee-textMuted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
            placeholder="Search code..."
            className="min-w-0 flex-1 bg-transparent py-1 text-[11px] text-bee-text outline-none placeholder:text-bee-textMuted/50"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-sleek">
        {searching ? (
          <div className="px-3 py-2 text-[11px] text-bee-textMuted">Searching…</div>
        ) : results.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-4 text-center text-bee-textMuted">
            <Search className="size-6 mb-2 opacity-50 text-bee-gold" />
            <p className="text-xs font-medium">{query ? "No results" : "Search project code"}</p>
          </div>
        ) : (
          <div className="py-1">
            {results.map((r, i) => (
              <div
                key={i}
                onClick={() => onOpen({ path: r.path, line: r.line })}
                className="px-3 py-1.5 text-[11px] hover:bg-bee-border/20 cursor-pointer transition-colors"
              >
                <span className="text-bee-gold truncate block">{r.path}</span>
                <span className="text-bee-textMuted/70">Line {r.line}: {r.text.slice(0, 80)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ADEWorktreeSidebar({ projectPath, pinned = true, onTogglePin, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<LeftTab>("workspaces");
  const [viewer, setViewer] = useState<ViewerTarget | null>(null);

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

  const TABS: { id: LeftTab; label: string; icon: LucideIcon }[] = [
    { id: "workspaces", label: "Workspaces", icon: Hexagon },
    { id: "explorer", label: "Explorer", icon: Folder },
    { id: "search", label: "Search", icon: Search },
  ];

  // Narrow sidebar → icon-only tabs (matches the right dock's behavior).
  const compact = sidebarWidth < 300;

  return (
    <div
      ref={sidebarRef}
      className="relative h-full flex flex-col bg-bee-surface/70 backdrop-blur-md border-r border-bee-border/50 shrink-0"
      style={{ width: sidebarWidth }}
    >
      {/* Sidebar Sub-Tabs Header (Workspaces, Explorer, Search) */}
      <div className="flex items-center border-b border-bee-border/40 shrink-0">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setViewer(null); }}
              title={tab.label}
              className={`flex items-center justify-center gap-1.5 flex-1 min-w-0 h-9 px-2 text-[11px] font-medium transition-colors whitespace-nowrap ${
                active
                  ? "text-bee-goldHi bg-bee-gold/[0.06] border-b-2 border-bee-gold"
                  : "text-bee-textMuted hover:text-bee-textDim hover:bg-bee-border/20"
              }`}
            >
              <Icon className="size-3.5 shrink-0" />
              {!compact && <span className="truncate">{tab.label}</span>}
            </button>
          );
        })}

        <div className="flex items-center pr-1 shrink-0">
          <button
            onClick={onTogglePin}
            className={`size-7 flex items-center justify-center transition-colors ${
              pinned ? "text-bee-goldHi/70" : "text-bee-textMuted hover:text-bee-textDim"
            }`}
            title={pinned ? "Unpin sidebar" : "Pin sidebar"}
          >
            {pinned ? <PinOff size={12} /> : <Pin size={12} />}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="size-7 flex items-center justify-center text-bee-textMuted hover:text-bee-text hover:bg-bee-border/30 transition-colors"
              title="Close sidebar"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Main Tab Content */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        {viewer ? (
          <FileViewer target={viewer} onBack={() => setViewer(null)} />
        ) : activeTab === "explorer" ? (
          <ExplorerPanel projectPath={projectPath || null} onOpen={setViewer} />
        ) : activeTab === "search" ? (
          <SearchPanel projectPath={projectPath || null} onOpen={setViewer} />
        ) : (
          /* Workspaces Tab Content */
          <>
            {/* Filter + Add Toolbar */}
            <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-bee-border/30">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setHideSleeping(!hideSleeping)}
                  className={`size-6 rounded flex items-center justify-center transition-colors ${
                    hideSleeping ? "text-bee-goldHi bg-bee-gold/10" : "text-bee-textMuted hover:text-bee-text hover:bg-bee-border/40"
                  }`}
                  title={hideSleeping ? "Show sleeping" : "Hide sleeping"}
                >
                  {hideSleeping ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                </button>
                <span className="text-[10px] font-medium text-bee-textMuted bg-bee-border/20 px-1.5 py-0.5 rounded-full">
                  {visibleWorkspaces.length}
                </span>
              </div>

              <button
                onClick={handleAdd}
                className="flex items-center gap-1 rounded bg-bee-gold/10 px-2 py-0.5 text-[10px] font-medium text-bee-goldHi hover:bg-bee-gold/20 transition-colors"
              >
                <Plus className="size-3" /> New Workspace
              </button>
            </div>

            {/* Workspaces Search */}
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

            {/* Flat workspace list */}
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

                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: ws.color }}
                        />

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
          </>
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

      {/* Resize handle */}
      <div
        className="absolute -right-2 top-0 z-40 flex h-full w-4 cursor-col-resize items-stretch justify-center group select-none"
        onMouseDown={handleResizeStart}
      >
        <div className="h-full w-px bg-bee-border/40 transition-colors group-hover:bg-bee-gold/60 group-active:bg-bee-gold" />
      </div>

      <WorkspaceCreateDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
      />
    </div>
  );
}
