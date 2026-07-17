"use client";

import type { TaskCard, ColumnId } from "../board.js";
import { buildPipeline } from "../pipeline.js";
import type { NodeStatus } from "../pipeline.js";

/* ── Column + status palettes (match the pipeline board) ─────── */

const COLUMN_META: { id: ColumnId; label: string; color: string }[] = [
  { id: "backlog",     label: "Backlog",     color: "#6b7280" },
  { id: "todo",        label: "Todo",        color: "#3b82f6" },
  { id: "in-progress", label: "In Progress", color: "#f59e0b" },
  { id: "review",      label: "Review",      color: "#a855f7" },
  { id: "done",        label: "Done",        color: "#22c55e" },
];

const STATUS_COLOR: Record<NodeStatus, string> = {
  pending: "#6b7280",
  active:  "#f59e0b",
  review:  "#a855f7",
  done:    "#22c55e",
  pass:    "#22c55e",
  failed:  "#ef4444",
};

export interface ProgressBoardProps {
  tasks: TaskCard[];
  statuses?: Record<string, string>;
}

export default function ProgressBoard({ tasks, statuses = {} }: ProgressBoardProps) {
  const total = tasks.length;
  const done = tasks.filter((t) => t.column === "done").length;
  const blocked = tasks.filter((t) => t.blockingReason).length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  const stages = buildPipeline(tasks, statuses);

  if (total === 0) {
    return (
      <div className="flex h-full items-center justify-center text-[11px] text-bee-textMuted">
        No tasks yet — dispatch a goal to QueenBee to populate the mission.
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto scrollbar-sleek px-4 py-3">
      {/* ── Overall completion ─────────────────────────────── */}
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-semibold text-bee-text">Mission progress</span>
        <span className="text-[11px] text-bee-textMuted">
          <span className="text-bee-gold font-semibold">{done}</span> / {total} done
          {blocked > 0 && <span className="ml-2 text-[#ef4444]">{blocked} blocked</span>}
        </span>
      </div>

      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-bee-border/40">
        <div
          className="h-full rounded-full bg-gradient-to-r from-bee-gold to-bee-goldHi transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1 text-[9px] text-bee-textMuted">{pct}% complete</div>

      {/* ── Per-column counts ──────────────────────────────── */}
      <div className="mt-4 grid grid-cols-5 gap-1.5">
        {COLUMN_META.map((c) => {
          const n = tasks.filter((t) => t.column === c.id).length;
          return (
            <div
              key={c.id}
              className="rounded-md border border-bee-border/40 bg-bee-canvas/40 px-2 py-1.5"
            >
              <div className="flex items-center gap-1">
                <span className="size-1.5 shrink-0 rounded-full" style={{ background: c.color }} />
                <span className="truncate text-[8px] uppercase tracking-wide text-bee-textMuted">
                  {c.label}
                </span>
              </div>
              <div className="mt-0.5 text-[13px] font-semibold text-bee-text">{n}</div>
            </div>
          );
        })}
      </div>

      {/* ── Stage rundown ──────────────────────────────────── */}
      <div className="mt-4 text-[10px] font-semibold uppercase tracking-wider text-bee-gold">
        Stages
      </div>
      <div className="mt-1.5 space-y-1">
        {stages.map((s) => {
          const st = s.nodes[0]?.status ?? "pending";
          return (
            <div
              key={s.id}
              className="flex items-center gap-2 rounded-md border border-bee-border/30 bg-bee-canvas/30 px-2.5 py-1.5"
            >
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{ background: STATUS_COLOR[st] }}
              />
              <span className="w-24 shrink-0 truncate text-[10px] font-medium text-bee-text">
                {s.title}
              </span>
              <span className="flex-1 truncate text-[9px] text-bee-textMuted">{s.statusText}</span>
              <span
                className="shrink-0 rounded px-1 py-px text-[7px] font-bold uppercase tracking-wide"
                style={{ background: `${STATUS_COLOR[st]}1f`, color: STATUS_COLOR[st] }}
              >
                {st}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
