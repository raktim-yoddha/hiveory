"use client";

import {
  Play, Calendar, GitBranch, Code2, Layers,
  ShieldCheck, BadgeCheck, Square,
} from "lucide-react";
import type { ComponentType } from "react";
import type { TaskCard } from "../board.js";
import { buildPipeline, type PipelineStage } from "../pipeline.js";

/* ── Layout constants ─────────────────────────────────────────── */

const NW = 130;
const NH = 58;
const GAP = 22;
const BGAP = 168;
const CY = 64;
const B_VGAP = 88;
const PAD = 14;
const AW = 7;
const PORT_R = 3.5;

/* ── Color constants ─────────────────────────────────────────── */

const CONNECTOR_COLOR = "#c9a227";

interface Palette { icon: ComponentType<{ size?: number; className?: string }>; accent: string }

const PAL: Record<string, Palette> = {
  start:       { icon: Play,       accent: "#22c55e" },
  planner:     { icon: Calendar,   accent: "#22c55e" },
  coordinator: { icon: GitBranch,  accent: "#f59e0b" },
  builder:     { icon: Code2,      accent: "#3b82f6" },
  aggregator:  { icon: Layers,     accent: "#c9a227" },
  reviewer:    { icon: ShieldCheck,accent: "#22c55e" },
  verifier:    { icon: BadgeCheck, accent: "#f59e0b" },
  end:         { icon: Square,     accent: "#6b7280" },
};

/* ── Node descriptor ──────────────────────────────────────────── */

interface NodeD {
  id: string;
  kind: string;
  x: number;
  y: number;
  accent: string;
  title: string;
  role: string;
  tag: string;
  statusText: string;
  stage: PipelineStage | null;
}

/* ── Helpers ──────────────────────────────────────────────────── */

function nodeRole(kind: string, stage: PipelineStage | null): string {
  if (!stage) return kind === "start" ? "START" : "END";
  const n = stage.nodes[0];
  if (n?.role) return n.role.toUpperCase();
  const m: Record<string, string> = {
    start:"START", planner:"ORCHESTRATOR", coordinator:"DISPATCH",
    builder:"BUILDER", aggregator:"MERGE", reviewer:"REVIEW",
    verifier:"VERIFY", end:"END",
  };
  return m[kind] || kind.toUpperCase();
}

function nodeTag(kind: string, stage: PipelineStage | null): string {
  if (!stage) return kind === "start" ? "START" : "END";
  const n = stage.nodes[0];
  return n?.tag || (n?.cli || kind).toUpperCase();
}

/* ── Sub-components ───────────────────────────────────────────── */

function GraphNode({ n }: { n: NodeD }) {
  const Icon = PAL[n.kind]?.icon || Square;
  return (
    <div
      className="absolute flex flex-col overflow-hidden rounded-lg"
      style={{
        left: n.x, top: n.y, width: NW, height: NH,
        // Honey palette (bee.surfaceHi -> bee.canvasHi). Cold blue-greys read as
        // foreign next to the app's warm surfaces.
        background: "linear-gradient(180deg,#2b2420 0%,#1c1613 100%)",
        border: "1px solid #3d2e1f",
        boxShadow: "0 2px 6px rgba(0,0,0,0.35)",
        padding: "7px 9px 8px",
      }}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <span
          className="flex size-4 shrink-0 items-center justify-center rounded"
          style={{ background: `${n.accent}22`, color: n.accent }}
        >
          <Icon size={10} className="shrink-0" />
        </span>
        <span className="text-[10px] font-semibold text-white truncate leading-none">
          {n.title}
        </span>
      </div>
      <span
        className="text-[7px] font-bold uppercase tracking-[0.1em] truncate leading-none mt-[5px]"
        style={{ color: n.accent }}
      >
        {n.role}
      </span>
      {n.statusText && (
        <span className="text-[8px] text-bee-textMuted leading-[1.35] truncate mt-auto pb-px">
          {n.statusText}
        </span>
      )}
    </div>
  );
}

function Arrow({ x, y }: { x: number; y: number }) {
  return (
    <polygon
      points={`${x - AW},${y - AW / 2} ${x},${y} ${x - AW},${y + AW / 2}`}
      fill={CONNECTOR_COLOR}
    />
  );
}

function PortCircle({ cx, cy }: { cx: number; cy: number }) {
  return (
    <circle cx={cx} cy={cy} r={PORT_R} fill="none" stroke={CONNECTOR_COLOR} strokeWidth={1.5} />
  );
}

function MidDot({ cx, cy }: { cx: number; cy: number }) {
  return (
    <circle cx={cx} cy={cy} r={2.5} fill={CONNECTOR_COLOR} opacity={0.5} />
  );
}

/* ── Main component ───────────────────────────────────────────── */

export interface PipelineBoardProps {
  open: boolean;
  tasks: TaskCard[];
  statuses?: Record<string, string>;
  onClose: () => void;
}

export default function PipelineBoard({ open, tasks, statuses = {}, onClose }: PipelineBoardProps) {
  if (!open) return null;

  const core = buildPipeline(tasks, statuses);
  const bStage = core.find((s) => s.kind === "builder")!;
  const bCount = bStage.nodes.length;
  const branch = bStage.layout === "parallel" && bCount >= 2;

  /* ── compute positions ─────────────────────────────────────── */

  const mainY = CY - NH / 2;

  const plannerX = PAD;
  const coordX = plannerX + NW + GAP;
  const coordRight = coordX + NW;

  /* builder gets its own column between coordinator and aggregator so a
     single (non-parallel) builder never lands on top of the coordinator. */
  const bX = branch ? coordRight + (BGAP - NW) / 2 : coordRight + GAP;
  const bRight = bX + NW;
  const aggX = branch ? coordRight + BGAP : bRight + GAP;

  const reviewerX = aggX + NW + GAP;
  const verifierX = reviewerX + NW + GAP;

  /* builder positions */
  const bYList = branch
    ? Array.from({ length: bCount }, (_, i) => mainY + i * B_VGAP)
    : [mainY];

  /* total dimensions */
  const totalW = verifierX + NW + PAD;
  const bottomMost = branch ? bYList[bCount - 1] + NH : mainY + NH;
  const totalH = bottomMost + PAD;

  /* ── build node list ───────────────────────────────────────── */

  const nodes: NodeD[] = [];

  const plannerStage = core.find((s) => s.kind === "planner")!;
  nodes.push({
    id: "planner", kind: "planner",
    x: plannerX, y: mainY, accent: PAL.planner.accent,
    title: "Planner", role: nodeRole("planner", plannerStage),
    tag: nodeTag("planner", plannerStage),
    statusText: plannerStage.statusText,
    stage: plannerStage,
  });

  const coordStage = core.find((s) => s.kind === "coordinator")!;
  nodes.push({
    id: "coordinator", kind: "coordinator",
    x: coordX, y: mainY, accent: PAL.coordinator.accent,
    title: "Coordinator", role: nodeRole("coordinator", coordStage),
    tag: nodeTag("coordinator", coordStage),
    statusText: coordStage.statusText,
    stage: coordStage,
  });

  /* builders */
  const builderNodes: NodeD[] = [];
  bStage.nodes.forEach((n, i) => {
    const nd: NodeD = {
      id: n.id, kind: "builder",
      x: bX, y: bYList[i],
      accent: PAL.builder.accent,
      title: n.label,
      role: (n.role || "BUILDER").toUpperCase(),
      tag: n.tag || "BUILD",
      statusText: n.subtitle || "",
      stage: null,
    };
    builderNodes.push(nd);
    nodes.push(nd);
  });

  const aggStage = core.find((s) => s.kind === "aggregator")!;
  nodes.push({
    id: "aggregator", kind: "aggregator",
    x: aggX, y: mainY, accent: PAL.aggregator.accent,
    title: "Aggregator", role: nodeRole("aggregator", aggStage),
    tag: nodeTag("aggregator", aggStage),
    statusText: aggStage.statusText,
    stage: aggStage,
  });

  const revStage = core.find((s) => s.kind === "reviewer")!;
  nodes.push({
    id: "reviewer", kind: "reviewer",
    x: reviewerX, y: mainY, accent: PAL.reviewer.accent,
    title: "Reviewer", role: nodeRole("reviewer", revStage),
    tag: nodeTag("reviewer", revStage),
    statusText: revStage.statusText,
    stage: revStage,
  });

  const verStage = core.find((s) => s.kind === "verifier")!;
  nodes.push({
    id: "verifier", kind: "verifier",
    x: verifierX, y: mainY, accent: PAL.verifier.accent,
    title: "Verifier", role: nodeRole("verifier", verStage),
    tag: nodeTag("verifier", verStage),
    statusText: verStage.statusText,
    stage: verStage,
  });

  const getNode = (id: string) => nodes.find((n) => n.id === id)!;

  /* ── build connections ─────────────────────────────────────── */

  interface Conn { fromId: string; toId: string; curved?: boolean }

  const conns: Conn[] = [];

  conns.push({ fromId: "planner", toId: "coordinator" });

  if (branch) {
    builderNodes.forEach((bn) => {
      conns.push({ fromId: "coordinator", toId: bn.id, curved: true });
    });
  } else if (builderNodes.length > 0) {
    conns.push({ fromId: "coordinator", toId: builderNodes[0].id });
  }

  if (branch) {
    builderNodes.forEach((bn) => {
      conns.push({ fromId: bn.id, toId: "aggregator", curved: true });
    });
  } else if (builderNodes.length > 0) {
    conns.push({ fromId: builderNodes[0].id, toId: "aggregator" });
  } else {
    conns.push({ fromId: "coordinator", toId: "aggregator" });
  }

  conns.push({ fromId: "aggregator", toId: "reviewer" });
  conns.push({ fromId: "reviewer", toId: "verifier" });

  /* ── render SVG path for a connection ──────────────────────── */

  function renderConn(c: Conn) {
    const from = getNode(c.fromId);
    const to = getNode(c.toId);
    const x1 = from.x + NW;
    const y1 = from.y + NH / 2;
    const x2 = to.x;
    const y2 = to.y + NH / 2;

    if (c.curved) {
      const mx = (x1 + x2) / 2;
      const d = `M ${x1},${y1} C ${mx},${y1} ${mx},${y2} ${x2 - AW},${y2}`;
      return (
        <g key={`${c.fromId}-${c.toId}`}>
          <path d={d} stroke={CONNECTOR_COLOR} strokeWidth={1.5} fill="none" />
          <Arrow x={x2} y={y2} />
        </g>
      );
    }

    const mx = (x1 + x2) / 2;
    const d = `M ${x1},${y1} L ${x2 - AW},${y2}`;
    return (
      <g key={`${c.fromId}-${c.toId}`}>
        <path d={d} stroke={CONNECTOR_COLOR} strokeWidth={1.5} fill="none" />
        <MidDot cx={mx} cy={y1} />
        <Arrow x={x2} y={y2} />
      </g>
    );
  }

  /* ── render ────────────────────────────────────────────────── */

  return (
    <div className="w-full overflow-x-auto overflow-y-hidden scrollbar-sleek" style={{ padding: "10px 0 4px" }}>
      <div className="relative" style={{ width: totalW, minHeight: totalH }}>
        <svg width={totalW} height={totalH} className="absolute inset-0 overflow-visible">
          {conns.map(renderConn)}

          {nodes.map((n) => (
            <g key={`ports-${n.id}`}>
              <PortCircle cx={n.x} cy={n.y + NH / 2} />
              <PortCircle cx={n.x + NW} cy={n.y + NH / 2} />
            </g>
          ))}
        </svg>

        {nodes.map((n) => (
          <GraphNode key={n.id} n={n} />
        ))}
      </div>
    </div>
  );
}
