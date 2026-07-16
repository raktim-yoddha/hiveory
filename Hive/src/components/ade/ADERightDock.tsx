"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  MessageSquareText,
  Search,
  GitBranch,
  X,
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  File,
  FileCode,
  FileText,
  FileCog,
  Braces,
  Hash,
  Pin,
  PinOff,
  type LucideIcon,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import QueenBeeChat from "@/components/queenbee/QueenBeeChat";

type DockTab = "chat" | "explorer" | "search" | "git";

interface Props {
  projectPath: string | null;
  activeWorkspaceId?: string;
  pinned?: boolean;
  onTogglePin?: () => void;
  onClose: () => void;
  onOpenSettings?: () => void;
  onOpenProject?: () => void;
}

// ── File Tree Node ──────────────────────────────────────────────
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

// ── Explorer Panel ──────────────────────────────────────────────
function ExplorerPanel({ projectPath }: { projectPath: string | null }) {
  const [rootPath, setRootPath] = useState("");
  const [tree, setTree] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectPath) return;
    setRootPath(projectPath);
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
            className="group flex items-center gap-1.5 px-2 py-1 text-[13px] cursor-pointer rounded-md text-bee-textDim hover:bg-bee-gold/10 hover:text-bee-text transition-colors"
            style={{ paddingLeft: `${level * 12 + 8}px` }}
            onClick={() => {
              if (node.is_dir) toggleExpand(node);
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
        <FolderOpen className="size-6 mb-2 opacity-50" />
        <p className="text-xs font-medium">No project open</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden scrollbar-sleek">
      {loading ? (
        <div className="px-3 py-2 text-[13px] text-bee-textMuted">Loading…</div>
      ) : tree.length === 0 ? (
        <div className="px-3 py-2 text-[13px] text-bee-textMuted">No files</div>
      ) : (
        <div className="py-1.5">{renderNodes(tree)}</div>
      )}
    </div>
  );
}

// ── Search Panel ────────────────────────────────────────────────
function SearchPanel({ projectPath }: { projectPath: string | null }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ path: string; line: number; text: string }[]>([]);
  const [searching, setSearching] = useState(false);

  const handleSearch = async () => {
    if (!query.trim() || !projectPath) return;
    setSearching(true);
    try {
      const apis = await import("@/lib/tauri").then((m) => m.getTauriAPIs());
      if (!apis?.invoke) return;
      const grep = await apis.invoke<string>("run_command", {
        command: "rg",
        args: ["--no-heading", "--line-number", query, projectPath],
      });
      const lines = grep.split("\n").filter(Boolean).slice(0, 100);
      setResults(
        lines.map((l) => {
          const parts = l.split(":", 3);
          return { path: parts[0] || "", line: parseInt(parts[1]) || 0, text: parts[2] || "" };
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
            placeholder="Search files..."
            className="min-w-0 flex-1 bg-transparent py-1 text-[11px] text-bee-text outline-none placeholder:text-bee-textMuted/50"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-sleek">
        {searching ? (
          <div className="px-3 py-2 text-[11px] text-bee-textMuted">Searching…</div>
        ) : results.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-4 text-center text-bee-textMuted">
            <Search className="size-6 mb-2 opacity-50" />
            <p className="text-xs font-medium">{query ? "No results" : "Search file contents"}</p>
          </div>
        ) : (
          <div className="py-1">
            {results.map((r, i) => (
              <div key={i} className="px-3 py-1.5 text-[11px] hover:bg-bee-border/20 cursor-pointer transition-colors">
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

// ── Git Panel ──────────────────────────────────────────────────
function GitPanel({ projectPath }: { projectPath: string | null }) {
  const [branch, setBranch] = useState("");
  const [changed, setChanged] = useState(0);
  const [changes, setChanges] = useState<string[]>([]);

  useEffect(() => {
    if (!projectPath) return;
    let cancelled = false;
    const fetchGit = async () => {
      try {
        const apis = await import("@/lib/tauri").then((m) => m.getTauriAPIs());
        if (!apis?.invoke) return;
        const status = await apis.invoke<{ branch: string; changed: number }>("git_status", { projectPath });
        if (cancelled) return;
        setBranch(status.branch);
        setChanged(status.changed);
        const raw = await apis.invoke<string>("run_command", {
          command: "git",
          args: ["-C", projectPath, "status", "--porcelain"],
        });
        if (!cancelled) setChanges(raw.split("\n").filter(Boolean));
      } catch {}
    };
    fetchGit();
    const interval = setInterval(fetchGit, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [projectPath]);

  if (!projectPath) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-4 text-center text-bee-textMuted">
        <GitBranch className="size-6 mb-2 opacity-50" />
        <p className="text-xs font-medium">No project open</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto scrollbar-sleek">
      <div className="px-3 py-2.5 border-b border-bee-border/30">
        <div className="flex items-center gap-2 text-xs">
          <GitBranch className="size-3.5 text-bee-gold" />
          <span className="text-bee-text font-medium">{branch || "no repo"}</span>
        </div>
        {changed > 0 && (
          <span className="text-[11px] text-bee-textMuted mt-1 block">{changed} changed file(s)</span>
        )}
      </div>
      {changes.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full px-4 text-center text-bee-textMuted">
          <GitBranch className="size-6 mb-2 opacity-50" />
          <p className="text-xs font-medium">No changes</p>
        </div>
      ) : (
        <div className="py-1">
          {changes.map((line, i) => {
            const status = line.slice(0, 2).trim();
            const file = line.slice(3);
            const statusColor = status === "M" ? "text-bee-gold" : status === "?" ? "text-bee-textMuted" : "text-bee-err";
            return (
              <div key={i} className="flex items-center gap-2 px-3 py-1.5 text-[11px] hover:bg-bee-border/20 cursor-pointer transition-colors">
                <span className={`font-mono text-[10px] w-4 ${statusColor}`}>{status}</span>
                <span className="truncate text-bee-textDim">{file}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Dock ───────────────────────────────────────────────────────
const TABS: { id: DockTab; label: string; icon: typeof MessageSquareText }[] = [
  { id: "chat", label: "Chat", icon: MessageSquareText },
  { id: "explorer", label: "Explorer", icon: Folder },
  { id: "search", label: "Search", icon: Search },
  { id: "git", label: "Git", icon: GitBranch },
];

const RIGHT_DOCK_MIN = 260;
const RIGHT_DOCK_MAX = 500;

export default function ADERightDock({ projectPath, activeWorkspaceId, pinned = true, onTogglePin, onClose, onOpenSettings, onOpenProject }: Props) {
  const [activeTab, setActiveTab] = useState<DockTab>("chat");
  const [dockWidth, setDockWidth] = useState(320);
  // Not enough room for five labelled tabs + pin + close → show icons only.
  const compact = dockWidth < 440;
  const [isResizing, setIsResizing] = useState(false);
  const dockRef = useRef<HTMLDivElement>(null);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;
    const handleMouseMove = (e: MouseEvent) => {
      if (!dockRef.current) return;
      const rect = dockRef.current.getBoundingClientRect();
      let newWidth = rect.right - e.clientX;
      newWidth = Math.max(RIGHT_DOCK_MIN, Math.min(RIGHT_DOCK_MAX, newWidth));
      setDockWidth(newWidth);
    };
    const handleMouseUp = () => setIsResizing(false);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing]);

  return (
    <div
      ref={dockRef}
      className="relative h-full flex flex-col bg-bee-surface/70 backdrop-blur-md border-l border-bee-border/50"
      style={{ width: dockWidth, minWidth: RIGHT_DOCK_MIN, maxWidth: RIGHT_DOCK_MAX }}
    >
      {/* Dock header with sub-tabs. Below ~440px the labels don't fit alongside
          all five tabs + pin + close, so collapse to icon-only rather than
          letting the row scroll and hide the pin/close controls. */}
      <div className="flex items-center border-b border-bee-border/40 shrink-0">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              title={tab.label}
              className={`flex items-center justify-center gap-1 flex-1 min-w-0 h-8 px-2 text-[11px] font-medium transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? "text-bee-goldHi bg-bee-gold/[0.06] border-b-2 border-bee-gold"
                  : "text-bee-textMuted hover:text-bee-textDim hover:bg-bee-border/20"
              }`}
            >
              <Icon className="size-3.5 shrink-0" />
              {!compact && <span className="truncate">{tab.label}</span>}
            </button>
          );
        })}
        <button
          onClick={onTogglePin}
          className={`size-8 flex items-center justify-center transition-colors shrink-0 ${
            pinned ? "text-bee-goldHi/70" : "text-bee-textMuted hover:text-bee-textDim"
          }`}
          title={pinned ? "Unpin panel" : "Pin panel"}
        >
          {pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
        </button>
        <button
          onClick={onClose}
          className="size-8 flex items-center justify-center text-bee-textMuted hover:text-bee-text hover:bg-bee-border/30 transition-colors shrink-0"
          title="Close panel"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {/* Resize handle — left edge, mirrors left sidebar's right-edge handle */}
      <div
        className="absolute -left-2 top-0 z-40 flex h-full w-4 cursor-col-resize items-stretch justify-center group select-none"
        onMouseDown={handleResizeStart}
        title="Drag to resize panel"
      >
        <div className={`h-full w-0.5 transition-colors ${isResizing ? "bg-bee-gold" : "bg-bee-border/60 group-hover:bg-bee-gold/80"}`} />
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === "chat" && <QueenBeeChat docked onToggleDock={() => {}} onOpenSettings={onOpenSettings} onOpenProject={onOpenProject} />}
        {activeTab === "explorer" && <ExplorerPanel projectPath={projectPath} />}
        {activeTab === "search" && <SearchPanel projectPath={projectPath} />}
        {activeTab === "git" && <GitPanel projectPath={projectPath} />}
      </div>
    </div>
  );
}
