"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Search,
  X,
  RefreshCw,
  LoaderCircle,
  ChevronRight,
  ArchiveRestore,
  Bot,
  GitBranch,
  MessageSquare,
  Clock,
} from "lucide-react";
import { Nectar, type NectarSessionEntry } from "@/lib/nectar";

type ScopeTab = "worktree" | "workspace" | "all";

interface Props {
  projectPath: string | null;
  activeWorktreeId?: string;
  activeWorkspaceId?: string;
}

function relativeTime(ts: number | null): string {
  if (!ts) return "";
  const now = Date.now();
  const diff = now - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

function agentIcon(agentType: string): string {
  const icons: Record<string, string> = {
    "claude-code": "CC",
    "codex-cli": "CX",
    aider: "AD",
    "antigravity-cli": "AG",
    opencode: "OC",
    "kimi-code": "KC",
    cline: "CL",
    cursor: "CU",
    kiro: "KR",
    kilo: "KL",
  };
  return icons[agentType] || agentType.slice(0, 2).toUpperCase();
}

const AGENT_COLORS: Record<string, string> = {
  "claude-code": "text-purple-400",
  "codex-cli": "text-blue-400",
  aider: "text-green-400",
  "antigravity-cli": "text-cyan-400",
  opencode: "text-orange-400",
  "kimi-code": "text-pink-400",
  cline: "text-yellow-400",
  cursor: "text-teal-400",
  kiro: "text-rose-400",
  kilo: "text-indigo-400",
};

export default function ADESessionHistory({
  projectPath,
  activeWorktreeId,
  activeWorkspaceId,
}: Props) {
  const [sessions, setSessions] = useState<NectarSessionEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<ScopeTab>("workspace");
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const nectarRef = useRef<Nectar | null>(null);
  const fetchIdRef = useRef(0);

  const fetchSessions = useCallback(
    async (force?: boolean) => {
      if (!projectPath) return;
      setLoading(true);
      setError(null);
      const fetchId = ++fetchIdRef.current;

      try {
        const nectar = new Nectar(projectPath);
        nectarRef.current = nectar;
        const result = await nectar.listSessions(scope, searchQuery || undefined, activeWorktreeId, activeWorkspaceId);
        if (fetchId !== fetchIdRef.current) return;
        setSessions(result.sessions);
      } catch (e) {
        if (fetchId !== fetchIdRef.current) return;
        setError(String(e));
        setSessions([]);
      } finally {
        if (fetchId === fetchIdRef.current) {
          setLoading(false);
        }
      }
    },
    [projectPath, scope, searchQuery, activeWorktreeId, activeWorkspaceId]
  );

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const groups = useMemo(() => {
    const map = new Map<string, NectarSessionEntry[]>();
    for (const s of sessions) {
      const key = s.agent_type || "unknown";
      const existing = map.get(key) || [];
      existing.push(s);
      map.set(key, existing);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [sessions]);

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const scopeOptions: { value: ScopeTab; label: string }[] = [
    { value: "worktree", label: "This worktree" },
    { value: "workspace", label: "This workspace" },
    { value: "all", label: "All" },
  ];

  return (
    <div className="h-full flex flex-col bg-bee-surface/70 backdrop-blur-md border-l border-bee-border/50 overflow-hidden w-[300px] min-w-[260px] max-w-[420px]">
      {/* Header */}
      <div className="px-2.5 py-2 border-b border-bee-border/40 shrink-0">
        <div className="flex items-center gap-1.5">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold text-bee-text truncate">
              Agent Session History
            </div>
            <div className="text-[10px] text-bee-textMuted/70 truncate">
              {sessions.length > 0
                ? `${sessions.length} session${sessions.length !== 1 ? "s" : ""}`
                : "No sessions recorded"}
            </div>
          </div>
          <button
            onClick={() => fetchSessions(true)}
            disabled={loading}
            className="size-6 rounded-md flex items-center justify-center text-bee-textMuted hover:text-bee-text hover:bg-bee-border/40 transition-colors disabled:opacity-50"
            title="Refresh"
          >
            {loading ? (
              <LoaderCircle className="size-3 animate-spin" />
            ) : (
              <RefreshCw className="size-3" />
            )}
          </button>
        </div>

        {/* Scope tabs */}
        <div className="mt-2 flex h-7 rounded-md border border-bee-border/40 bg-bee-canvas/40 overflow-hidden">
          {scopeOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setScope(opt.value)}
              className={`flex-1 text-[10px] font-medium leading-none transition-colors ${
                scope === opt.value
                  ? "bg-bee-gold/10 text-bee-goldHi border-b-2 border-bee-gold"
                  : "text-bee-textMuted hover:text-bee-textDim hover:bg-bee-border/20"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="mt-2 flex h-7 items-center gap-1.5 rounded-md border border-bee-border/50 bg-bee-canvas/60 px-2 focus-within:border-bee-gold/40 focus-within:ring-[1px] focus-within:ring-bee-gold/20">
          <Search className="size-3 shrink-0 text-bee-textMuted" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search sessions..."
            className="min-w-0 flex-1 bg-transparent py-1 text-[11px] text-bee-text outline-none placeholder:text-bee-textMuted/50"
            spellCheck={false}
          />
          {loading ? (
            <LoaderCircle className="size-3 animate-spin text-bee-textMuted" />
          ) : null}
          {searchQuery ? (
            <button
              onClick={() => setSearchQuery("")}
              className="size-4 rounded flex items-center justify-center text-bee-textMuted hover:text-bee-text"
            >
              <X className="size-3" />
            </button>
          ) : null}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-sleek">
        {loading && sessions.length === 0 ? (
          <div className="px-3 py-3">
            <div className="flex items-center gap-2 text-[10px] text-bee-textMuted mb-3">
              <LoaderCircle className="size-3 animate-spin" />
              <span>Loading sessions...</span>
            </div>
            <div className="space-y-3">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="flex items-start gap-2">
                  <div className="mt-1 size-3 rounded-full bg-bee-border/30" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="h-2.5 w-4/5 rounded-sm bg-bee-border/30" />
                    <div className="h-2 w-3/5 rounded-sm bg-bee-border/20" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {!loading && sessions.length === 0 && !error ? (
          <div className="flex flex-col items-center justify-center h-full px-4 text-center text-bee-textMuted">
            <ArchiveRestore className="mb-2 size-6 opacity-50" />
            <p className="text-xs font-medium">No agent sessions found</p>
            <p className="text-[10px] mt-1 text-bee-textMuted/60">
              Sessions appear here when agents run in this project
            </p>
          </div>
        ) : null}

        {error ? (
          <div className="px-3 py-2 text-[10px] text-red-400">{error}</div>
        ) : null}

        {groups.length > 0 ? (
          <div className="pb-2">
            {groups.map(([agentKey, agentSessions]) => {
              const isCollapsed = collapsedGroups.has(agentKey);
              return (
                <div key={agentKey} className="border-b border-bee-border/20 last:border-b-0">
                  {/* Group header */}
                  <button
                    onClick={() => toggleGroup(agentKey)}
                    className="flex items-center w-full h-8 gap-1.5 px-3 text-left text-[10px] font-semibold text-bee-textDim hover:text-bee-text hover:bg-bee-border/20 transition-colors"
                  >
                    <ChevronRight
                      className={`size-3 shrink-0 transition-transform ${!isCollapsed ? "rotate-90" : ""}`}
                    />
                    <span className={AGENT_COLORS[agentKey] || "text-bee-gold"}>
                      {agentIcon(agentKey)}
                    </span>
                    <span className="min-w-0 flex-1 truncate capitalize">{agentKey}</span>
                    <span className="rounded border border-bee-border/40 bg-bee-border/20 px-1.5 py-0.5 text-[9px] font-medium tabular-nums leading-none text-bee-textMuted">
                      {agentSessions.length}
                    </span>
                  </button>

                  {/* Session cards */}
                  {!isCollapsed &&
                    agentSessions.map((session) => (
                      <div
                        key={session.id}
                        className="group flex flex-col px-3 py-2 border-b border-bee-border/10 last:border-b-0 hover:bg-bee-border/15 transition-colors cursor-pointer"
                      >
                        {/* Title row */}
                        <div className="flex items-start gap-2 min-w-0">
                          <Bot className="size-3.5 mt-0.5 shrink-0 text-bee-textMuted/60" />
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-medium text-bee-text line-clamp-1 leading-5">
                              {session.title}
                            </div>
                            {/* Preview */}
                            {session.preview && (
                              <div className="text-[10px] leading-3 text-bee-textMuted/70 mt-0.5 line-clamp-1">
                                {session.preview}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Meta row */}
                        <div className="flex items-center gap-2 mt-1.5 pl-6 flex-wrap">
                          {/* Agent type chip */}
                          <span
                            className={`inline-flex items-center gap-0.5 text-[9px] font-medium ${AGENT_COLORS[session.agent_type] || "text-bee-textMuted"}`}
                          >
                            <Bot className="size-2.5" />
                            {session.agent_type}
                          </span>

                          {/* Message count */}
                          {session.message_count != null && session.message_count > 0 && (
                            <span className="inline-flex items-center gap-0.5 text-[9px] text-bee-textMuted/60">
                              <MessageSquare className="size-2.5" />
                              {session.message_count}
                            </span>
                          )}

                          {/* Branch chip */}
                          {session.branch && (
                            <span className="inline-flex items-center gap-0.5 text-[9px] text-bee-textMuted/60 bg-bee-border/25 px-1.5 py-0.5 rounded-sm max-w-[100px]">
                              <GitBranch className="size-2.5 shrink-0" />
                              <span className="truncate">{session.branch}</span>
                            </span>
                          )}

                          {/* Timestamp */}
                          {session.timestamp && (
                            <span className="inline-flex items-center gap-0.5 text-[9px] text-bee-textMuted/50 ml-auto">
                              <Clock className="size-2.5" />
                              {relativeTime(session.timestamp)}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
