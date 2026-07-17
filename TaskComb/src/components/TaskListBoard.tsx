"use client";

import { GitBranch, FileCode, AlertTriangle, Link2 } from "lucide-react";
import type { TaskCard, ColumnId } from "../board.js";
import { nodeStatus } from "../pipeline.js";
import type { NodeStatus } from "../pipeline.js";

const COLUMN_META: { id: ColumnId; label: string; color: string }[] = [
  { id: "in-progress", label: "In Progress", color: "#f59e0b" },
  { id: "review",      label: "Review",      color: "#a855f7" },
  { id: "todo",        label: "Todo",        color: "#3b82f6" },
  { id: "backlog",     label: "Backlog",     color: "#6b7280" },
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

export interface TaskListBoardProps {
  tasks: TaskCard[];
  statuses?: Record<string, string>;
}

function TaskRow({ t, statuses }: { t: TaskCard; statuses: Record<string, string> }) {
  const st = nodeStatus(t, t.workerBeeId ? statuses[t.workerBeeId] : undefined);
  return (
    <div className="rounded-md border border-bee-border/30 bg-bee-canvas/30 px-2.5 py-1.5 transition-colors hover:border-bee-gold/40">
      <div className="flex items-center gap-2 min-w-0">
        <span className="size-1.5 shrink-0 rounded-full" style={{ background: STATUS_COLOR[st] }} />
        <span className="flex-1 truncate text-[10px] font-medium text-bee-text">{t.title}</span>
        {t.assignedCli && (
          <span className="shrink-0 rounded bg-bee-gold/10 px-1 py-px text-[7px] font-bold uppercase tracking-wide text-bee-gold">
            {t.assignedCli}
          </span>
        )}
        {t.assignedRole && (
          <span className="shrink-0 text-[7px] uppercase tracking-wide text-bee-textMuted">
            {t.assignedRole}
          </span>
        )}
      </div>

      {t.description && (
        <div className="mt-0.5 truncate pl-3.5 text-[9px] leading-[1.35] text-bee-textMuted">
          {t.description}
        </div>
      )}

      <div className="mt-1 flex flex-wrap items-center gap-2.5 pl-3.5 text-[8px] text-bee-textMuted">
        {t.worktreeBranch && (
          <span className="flex items-center gap-0.5 truncate">
            <GitBranch className="size-2.5 shrink-0 text-bee-gold/70" />
            {t.worktreeBranch}
          </span>
        )}
        {t.owns.length > 0 && (
          <span className="flex items-center gap-0.5" title={t.owns.join("\n")}>
            <FileCode className="size-2.5 shrink-0" />
            owns {t.owns.length}
          </span>
        )}
        {t.dependsOn.length > 0 && (
          <span className="flex items-center gap-0.5" title={t.dependsOn.join("\n")}>
            <Link2 className="size-2.5 shrink-0" />
            deps {t.dependsOn.length}
          </span>
        )}
      </div>

      {t.blockingReason && (
        <div className="mt-1 flex items-start gap-1 pl-3.5 text-[8px] leading-[1.35] text-[#ef4444]">
          <AlertTriangle className="mt-px size-2.5 shrink-0" />
          <span className="truncate">{t.blockingReason}</span>
        </div>
      )}
    </div>
  );
}

export default function TaskListBoard({ tasks, statuses = {} }: TaskListBoardProps) {
  if (tasks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-[11px] text-bee-textMuted">
        No tasks yet — dispatch a goal to QueenBee to populate the mission.
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto scrollbar-sleek px-4 py-3 space-y-3">
      {COLUMN_META.map((c) => {
        const rows = tasks
          .filter((t) => t.column === c.id)
          .sort((a, b) => a.sortOrder - b.sortOrder);
        if (rows.length === 0) return null;
        return (
          <div key={c.id}>
            <div className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full" style={{ background: c.color }} />
              <span className="text-[9px] font-semibold uppercase tracking-wider text-bee-textDim">
                {c.label}
              </span>
              <span className="text-[9px] text-bee-textMuted">{rows.length}</span>
            </div>
            <div className="mt-1 space-y-1">
              {rows.map((t) => (
                <TaskRow key={t.id} t={t} statuses={statuses} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
