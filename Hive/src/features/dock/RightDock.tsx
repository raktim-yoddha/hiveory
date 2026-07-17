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
  ArrowLeft,
  Plus,
  Minus,
  Check,
  type LucideIcon,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import QueenBeeChat from "@/features/queenbee/QueenBeeChat";

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

// ── File / diff viewer ──────────────────────────────────────────
// Read-only: the app has no editor yet, so Explorer/Search/Git open here.
interface ViewerTarget {
  path: string;
  line?: number;
  diff?: boolean;
  projectPath?: string | null;
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

  // Jump to the searched line once content is in.
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
        {target.diff && (
          <span className="ml-auto shrink-0 rounded bg-bee-gold/10 px-1 py-px text-[8px] font-bold uppercase text-bee-gold">
            diff
          </span>
        )}
      </div>

      <div className="flex-1 overflow-auto scrollbar-sleek">
        {loading ? (
          <div className="px-3 py-2 text-[11px] text-bee-textMuted">Loading…</div>
        ) : error ? (
          <div className="px-3 py-2 text-[11px] text-bee-err">{error}</div>
        ) : content.trim() === "" ? (
          <div className="px-3 py-2 text-[11px] text-bee-textMuted">
            {target.diff ? "No diff — file is unchanged or untracked." : "Empty file"}
          </div>
        ) : (
          <pre className="py-1 font-mono text-[10px] leading-[1.5]">
            {lines.map((l, i) => {
              const n = i + 1;
              const hit = target.line === n;
              // Diff colouring: additions green, deletions red, hunks gold.
              const color = target.diff
                ? l.startsWith("+") && !l.startsWith("+++")
                  ? "text-[#22c55e]"
                  : l.startsWith("-") && !l.startsWith("---")
                  ? "text-[#ef4444]"
                  : l.startsWith("@@")
                  ? "text-bee-gold"
                  : "text-bee-textDim"
                : "text-bee-textDim";
              return (
                <div
                  key={i}
                  ref={hit ? lineRef : undefined}
                  className={`flex gap-2 px-2 ${hit ? "bg-bee-gold/10" : ""}`}
                >
                  <span className="w-7 shrink-0 select-none text-right text-bee-textMuted/50">
                    {n}
                  </span>
                  <span className={`whitespace-pre-wrap break-all ${color}`}>{l || " "}</span>
                </div>
              );
            })}
          </pre>
        )}
      </div>
    </div>
  );
}

// ── Explorer Panel ──────────────────────────────────────────────
function ExplorerPanel({
  projectPath,
  onOpen,
}: {
  projectPath: string | null;
  onOpen: (t: ViewerTarget) => void;
}) {
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
      // rg prints "path:line:text". Splitting on ":" breaks Windows paths
      // ("C:\..."), so match the first ":<digits>:" separator instead.
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

// ── Git Panel ──────────────────────────────────────────────────
interface GitEntry { index: string; work: string; file: string; staged: boolean }

// Porcelain v1: "XY path". X = index (staged) state, Y = worktree state.
function parsePorcelain(raw: string): GitEntry[] {
  return raw.split("\n").filter(Boolean).map((l) => {
    const index = l[0] ?? " ";
    const work = l[1] ?? " ";
    let file = l.slice(3);
    // Renames come through as "old -> new"; the new path is what we act on.
    const arrow = file.indexOf(" -> ");
    if (arrow !== -1) file = file.slice(arrow + 4);
    file = file.replace(/^"|"$/g, "");
    return { index, work, file, staged: index !== " " && index !== "?" };
  });
}

function GitPanel({
  projectPath,
  onOpen,
}: {
  projectPath: string | null;
  onOpen: (t: ViewerTarget) => void;
}) {
  const [branch, setBranch] = useState("");
  const [entries, setEntries] = useState<GitEntry[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectPath) return;
    try {
      const status = await invoke<{ branch: string; changed: number }>("git_status", { projectPath });
      setBranch(status.branch);
      const raw = await invoke<string>("run_command", {
        command: "git",
        args: ["-C", projectPath, "status", "--porcelain"],
      });
      setEntries(parsePorcelain(raw));
    } catch {}
  }, [projectPath]);

  useEffect(() => {
    if (!projectPath) return;
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [projectPath, refresh]);

  // Run a git subcommand, then refresh. Surfaces failures instead of swallowing.
  const git = async (args: string[], okNote?: string) => {
    if (!projectPath || busy) return;
    setBusy(true);
    setNote(null);
    try {
      await invoke<string>("run_command", { command: "git", args: ["-C", projectPath, ...args] });
      if (okNote) setNote(okNote);
      await refresh();
    } catch (e: any) {
      setNote(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const staged = entries.filter((e) => e.staged);
  const unstaged = entries.filter((e) => !e.staged);

  if (!projectPath) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-4 text-center text-bee-textMuted">
        <GitBranch className="size-6 mb-2 opacity-50" />
        <p className="text-xs font-medium">No project open</p>
      </div>
    );
  }

  const Row = ({ e }: { e: GitEntry }) => {
    const code = (e.staged ? e.index : e.work).trim() || "?";
    const color =
      code === "M" ? "text-bee-gold" : code === "A" ? "text-[#22c55e]"
      : code === "D" ? "text-bee-err" : "text-bee-textMuted";
    return (
      <div className="group flex items-center gap-1.5 px-2 py-1 text-[11px] transition-colors hover:bg-bee-border/20">
        <span className={`w-3 shrink-0 font-mono text-[10px] ${color}`}>{code}</span>
        <span
          onClick={() => onOpen({ path: `${projectPath}/${e.file}`, diff: !e.file.startsWith("??"), projectPath })}
          className="flex-1 cursor-pointer truncate text-bee-textDim hover:text-bee-text"
          title={e.file}
        >
          {e.file}
        </span>
        <button
          disabled={busy}
          onClick={() => git(e.staged ? ["reset", "-q", "HEAD", "--", e.file] : ["add", "--", e.file])}
          className="shrink-0 rounded p-0.5 text-bee-textMuted opacity-0 transition-all hover:bg-bee-border/50 hover:text-bee-gold group-hover:opacity-100 disabled:opacity-30"
          title={e.staged ? "Unstage" : "Stage"}
        >
          {e.staged ? <Minus className="size-3" /> : <Plus className="size-3" />}
        </button>
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col">
      {/* Branch + commit box */}
      <div className="shrink-0 border-b border-bee-border/30 px-2.5 py-2">
        <div className="flex items-center gap-2 text-xs">
          <GitBranch className="size-3.5 shrink-0 text-bee-gold" />
          <span className="truncate font-medium text-bee-text">{branch || "no repo"}</span>
          <span className="ml-auto shrink-0 text-[10px] text-bee-textMuted">
            {entries.length} changed
          </span>
        </div>

        <div className="mt-2 flex items-center gap-1">
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && message.trim() && staged.length > 0) {
                git(["commit", "-m", message.trim()], "Committed").then(() => setMessage(""));
              }
            }}
            placeholder={staged.length ? "Commit message…" : "Stage files to commit"}
            className="min-w-0 flex-1 rounded-md border border-bee-border/50 bg-bee-canvas/60 px-2 py-1 text-[11px] text-bee-text outline-none transition-colors placeholder:text-bee-textMuted/50 focus:border-bee-gold/40"
          />
          <button
            disabled={busy || !message.trim() || staged.length === 0}
            onClick={() => git(["commit", "-m", message.trim()], "Committed").then(() => setMessage(""))}
            className="flex size-6 shrink-0 items-center justify-center rounded-md bg-bee-gold/10 text-bee-goldHi transition-colors hover:bg-bee-gold/20 disabled:opacity-30"
            title={staged.length ? `Commit ${staged.length} file(s)` : "Nothing staged"}
          >
            <Check className="size-3" />
          </button>
        </div>
        {note && <div className="mt-1 truncate text-[9px] text-bee-textMuted">{note}</div>}
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-sleek py-1">
        {entries.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-4 text-center text-bee-textMuted">
            <GitBranch className="mb-2 size-6 opacity-50" />
            <p className="text-xs font-medium">No changes</p>
          </div>
        ) : (
          <>
            {staged.length > 0 && (
              <>
                <div className="px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-bee-gold">
                  Staged ({staged.length})
                </div>
                {staged.map((e) => <Row key={`s-${e.file}`} e={e} />)}
              </>
            )}
            {unstaged.length > 0 && (
              <>
                <div className="px-2 pb-1 pt-2 text-[9px] font-semibold uppercase tracking-wider text-bee-textDim">
                  Changes ({unstaged.length})
                </div>
                {unstaged.map((e) => <Row key={`u-${e.file}`} e={e} />)}
              </>
            )}
          </>
        )}
      </div>
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
  const [viewer, setViewer] = useState<ViewerTarget | null>(null);
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
              onClick={() => { setActiveTab(tab.id); setViewer(null); }}
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
        {activeTab !== "chat" && viewer ? (
          <FileViewer target={viewer} onBack={() => setViewer(null)} />
        ) : (
          <>
            {activeTab === "explorer" && <ExplorerPanel projectPath={projectPath} onOpen={setViewer} />}
            {activeTab === "search" && <SearchPanel projectPath={projectPath} onOpen={setViewer} />}
            {activeTab === "git" && <GitPanel projectPath={projectPath} onOpen={setViewer} />}
          </>
        )}
      </div>
    </div>
  );
}
