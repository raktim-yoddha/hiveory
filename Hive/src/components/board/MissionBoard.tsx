"use client";

import { useEffect } from "react";
import { X, ChevronRight, Crown, GitBranch } from "lucide-react";
import type { TaskCard } from "@hiveory/taskcomb";
import { buildMissionMap, type NodeStatus, type MapNode } from "./missionMap";

// Local mission-pipeline visualization. Everything here is derived from task
// state on the client — no model calls, zero tokens.

const STATUS_STYLE: Record<NodeStatus, { box: string; dot: string; label: string }> = {
  active:  { box: "border-bee-gold bg-bee-gold/10 shadow-[0_0_16px_rgba(201,162,39,0.35)]", dot: "bg-bee-gold shadow-glow animate-pulse", label: "text-bee-goldHi" },
  review:  { box: "border-bee-gold/40 border-dashed bg-bee-gold/5", dot: "bg-bee-gold/70", label: "text-bee-gold" },
  done:    { box: "border-emerald-500/40 bg-emerald-500/[0.06]", dot: "bg-emerald-400", label: "text-emerald-300" },
  failed:  { box: "border-bee-err/60 bg-bee-err/10", dot: "bg-bee-err", label: "text-bee-err" },
  pending: { box: "border-bee-border/70 bg-bee-canvas/40", dot: "bg-bee-textMuted/50", label: "text-bee-textDim" },
};

function NodeCard({ node }: { node: MapNode }) {
  const s = STATUS_STYLE[node.status];
  const isQueen = node.id === "queenbee";
  return (
    <div className={`rounded-lg border px-3 py-2 min-w-[168px] transition-shadow ${s.box}`}>
      <div className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.dot}`} />
        {isQueen && <Crown size={11} className="text-bee-gold shrink-0" />}
        <span className={`text-xs font-semibold truncate ${s.label}`}>{node.label}</span>
      </div>
      {(node.cli || node.role) && (
        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-bee-textMuted">
          {node.role && <span className="uppercase tracking-wide">{node.role}</span>}
          {node.cli && <span className="font-mono text-bee-textDim">· {node.cli}</span>}
        </div>
      )}
      {node.branch && (
        <div className="mt-0.5 flex items-center gap-1 text-[10px] text-bee-textMuted font-mono truncate">
          <GitBranch size={9} className="shrink-0" />
          {node.branch}
        </div>
      )}
    </div>
  );
}

export interface MissionBoardProps {
  open: boolean;
  tasks: TaskCard[];
  statuses?: Record<string, string>;
  onClose: () => void;
}

export default function MissionBoard({ open, tasks, statuses = {}, onClose }: MissionBoardProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const stages = buildMissionMap(tasks, statuses);

  return (
    <div
      className="absolute inset-x-0 z-50 flex flex-col overflow-hidden glass-hi border-t border-bee-gold/25"
      style={{ bottom: 0, top: "40%" }}
    >
      <div className="flex items-center justify-between px-4 py-2 border-b border-bee-border/50 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-bee-goldHi">Mission Map</span>
          <span className="text-[10px] text-bee-textMuted">{tasks.length} task{tasks.length === 1 ? "" : "s"} · local view</span>
        </div>
        <button onClick={onClose} className="p-1 rounded-md hover:bg-bee-border/60 text-bee-textMuted hover:text-bee-text transition-colors" title="Close board">
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="flex items-stretch gap-2 min-w-max">
          {stages.map((stage, i) => (
            <div key={stage.id} className="flex items-stretch gap-2">
              <div className="flex flex-col gap-2 min-w-[180px]">
                <div className="text-[10px] uppercase tracking-wider text-bee-gold font-semibold px-1">{stage.title}</div>
                {stage.nodes.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-bee-border/50 px-3 py-2 text-[10px] text-bee-textMuted/60 italic">empty</div>
                ) : (
                  stage.nodes.map((n) => <NodeCard key={n.id} node={n} />)
                )}
              </div>
              {i < stages.length - 1 && (
                <div className="flex items-center text-bee-border">
                  <ChevronRight size={16} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
