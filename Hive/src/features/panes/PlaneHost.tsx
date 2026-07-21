"use client";

import { useEffect, useState, useRef } from "react";
import {
  Bot, Terminal as TerminalIcon, Globe, Smartphone,
  Plus, Maximize2, Minimize2,
  Sparkles, Code2, Rocket, Braces, Moon, MousePointer2, Wand2, Zap, SquareTerminal, Blocks, Search,
} from "lucide-react";
import { HoneyFlowLogo, HoneyFlowStrip, themeForKind, type StripItem } from "@hiveory/honeyflow";
import { OpenVsxLogo, OpenVsxPane } from "@hiveory/hiveextension";
import QueenCrown from "@/shared/QueenCrown";
import { invoke } from "@tauri-apps/api/core";
import WorkerBeePane from "@/features/worker-bees/WorkerBeePane";
import TerminalPane from "@/features/terminal/TerminalPane";
import BrowserPane from "@/features/browser/BrowserPane";
import EmulatorPane from "@/features/emulator/EmulatorPane";
import QueenBeeChat from "@/features/queenbee/QueenBeeChat";
import { CLI_METADATA } from "@hiveory/worker-bees";
import { PipelineBoard, type TaskCard } from "@hiveory/taskcomb";
import { X, Columns3 } from "lucide-react";
import HiveoryLogo from "@/shared/HiveoryLogo";
import { useWorkerBeesStore, type WorkerBee, type GridLayout } from "@/features/worker-bees/workerBeesStore";
import { useWorkspaceStore } from "@/features/workspaces/workspaceStore";
import { useExtensionStore } from "@/features/extensions/extensionStore";
import {
  usePlaneStore, PLANES, planeFor, paneInPlane, type PlaneKind, type PlaneDef,
} from "./planeStore";
import { GRID_PRESETS, presetFor, PresetThumb } from "./gridPresets";

const INTERACTIVE = "button, input, select, textarea, a, [contenteditable], [role='button']";

const PLANE_ICON: Record<PlaneKind, React.ComponentType<{ className?: string }>> = {
  honeyflow: HoneyFlowLogo,
  browser: Globe,
  emulator: Smartphone,
};

// Distinct icon per CLI agent (keyed by CLI slug) for the add menu + strip.
const CLI_ICON: Record<string, typeof Bot> = {
  "claude-code": Sparkles,
  "codex-cli": Code2,
  "aider": Bot,
  "antigravity-cli": Rocket,
  "opencode": Braces,
  "kimi-code": Moon,
  "cline": TerminalIcon,
  "cursor": MousePointer2,
  "kiro": Wand2,
  "kilo": Zap,
};

/** Icon node for a pane (CLI agent by command, a terminal, or an extension). */
function paneIconNode(bee: WorkerBee, cls = "size-3") {
  if (bee.kind === "shell") return <SquareTerminal className={cls} />;
  if (bee.kind === "openvsx")
    return bee.iconUrl ? <img src={bee.iconUrl} alt="" className={`${cls} rounded-sm object-contain`} /> : <OpenVsxLogo className={cls} />;
  const meta = CLI_METADATA.find((c) => c.command === bee.cli);
  const Icon = (meta && CLI_ICON[meta.id]) || Bot;
  return <Icon className={cls} />;
}

// Icon for a detected shell, chosen by its label.
function shellIcon(label: string): typeof Bot {
  const l = label.toLowerCase();
  if (l.includes("power") || l.includes("pwsh") || l.includes("cmd")) return TerminalIcon;
  return SquareTerminal;
}

interface Props {
  workingDir?: string | null;
}

export default function PlaneHost({ workingDir }: Props) {
  const workerBees = useWorkerBeesStore((s) => s.workerBees);
  const addWorkerBee = useWorkerBeesStore((s) => s.addWorkerBee);
  const setAgentStatus = useWorkerBeesStore((s) => s.setAgentStatus);
  const replaceAll = useWorkerBeesStore((s) => s.replaceAll);
  const removeWorkerBee = useWorkerBeesStore((s) => s.removeWorkerBee);
  const updateWorkerBee = useWorkerBeesStore((s) => s.updateWorkerBee);
  const maximizedPane = useWorkerBeesStore((s) => s.maximizedPane);
  const setMaximizedPane = useWorkerBeesStore((s) => s.setMaximizedPane);
  const reorderWorkerBees = useWorkerBeesStore((s) => s.reorderWorkerBees);
  const swapWorkerBees = useWorkerBeesStore((s) => s.swapWorkerBees);
  const refitTerminals = useWorkerBeesStore((s) => s.refitTerminals);
  const gridLayout = useWorkerBeesStore((s) => s.gridLayout);
  const setGridLayout = useWorkerBeesStore((s) => s.setGridLayout);
  const agentStatuses = useWorkerBeesStore((s) => s.agentStatuses);

  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const updateWorkspace = useWorkspaceStore((s) => s.updateWorkspace);
  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);

  const active = usePlaneStore((s) => s.active);
  const setActive = usePlaneStore((s) => s.setActive);
  const fullscreen = usePlaneStore((s) => s.fullscreen);
  const toggleFullscreen = usePlaneStore((s) => s.toggleFullscreen);
  const plane = planeFor(active);

  const [editingBee, setEditingBee] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [shells, setShells] = useState<{ id: string; label: string; command: string }[]>([]);
  const [focusedPane, setFocusedPane] = useState<string | null>(null);
  // Spotlight in Focus layouts — chosen by clicking a pane body, NOT by focus,
  // so clicking a pane's own buttons (e.g. delete) never reshuffles the grid.
  const [spotlightSel, setSpotlightSel] = useState<string | null>(null);

  // ── pointer-based pane drag (HTML5 DnD can't cross terminal/webview panes) ──
  const rootRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; name: string } | null>(null);
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const [over, setOver] = useState<
    { kind: "snap"; id: GridLayout } | { kind: "pane"; id: string } | null
  >(null);
  const pending = useRef<{ id: string; name: string; x: number; y: number } | null>(null);
  const dragId = useRef<string | null>(null);

  const hitTest = (x: number, y: number) => {
    const root = rootRef.current;
    if (!root) return null;
    for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-snap]"))) {
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)
        return { kind: "snap" as const, id: el.dataset.snap as GridLayout };
    }
    for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-pane-id]"))) {
      const id = el.dataset.paneId!;
      if (id === dragId.current) continue;
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)
        return { kind: "pane" as const, id };
    }
    return null;
  };

  const onDragMove = (e: MouseEvent) => {
    const p = pending.current;
    setPointer({ x: e.clientX, y: e.clientY });
    if (p && !dragId.current) {
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < 5) return;
      dragId.current = p.id;
      setDrag({ id: p.id, name: p.name });
    }
    if (dragId.current) setOver(hitTest(e.clientX, e.clientY));
  };
  const onDragUp = (e: MouseEvent) => {
    window.removeEventListener("mousemove", onDragMove);
    window.removeEventListener("mouseup", onDragUp);
    if (dragId.current) {
      const o = hitTest(e.clientX, e.clientY);
      if (o?.kind === "snap") setGridLayout(o.id);
      else if (o?.kind === "pane") {
        // Drop onto another pane = SWAP their positions (works in every grid,
        // Focus included: swapping into slot 0 makes that pane the spotlight).
        const from = workerBees.findIndex((b) => b.id === dragId.current);
        const to = workerBees.findIndex((b) => b.id === o.id);
        if (from >= 0 && to >= 0) swapWorkerBees(from, to);
      }
    }
    pending.current = null;
    dragId.current = null;
    setDrag(null);
    setOver(null);
  };
  const onPaneMouseDown = (e: React.MouseEvent, bee: WorkerBee) => {
    const t = e.target as HTMLElement;
    // Buttons/inputs handle themselves — never promote or drag from them, so a
    // pane's delete button works even in Focus mode.
    if (e.button !== 0 || t.closest(INTERACTIVE)) return;
    // A plain click must NOT change the spotlight — the spotlight only moves when
    // a pane is dragged and dropped onto another (positions swap). Otherwise
    // clicking anywhere in a pane would reshuffle the Focus grid.
    if (maximizedPane || !t.closest("[data-pane-drag]")) return;
    pending.current = { id: bee.id, name: bee.customName || bee.cliName, x: e.clientX, y: e.clientY };
    window.addEventListener("mousemove", onDragMove);
    window.addEventListener("mouseup", onDragUp);
  };

  /* ── workspace sync (unchanged) ─────────────────────────────── */
  useEffect(() => {
    if (activeWorkspace) replaceAll(activeWorkspace.paneLayout);
  }, [activeWorkspaceId, activeWorkspace?.paneLayout.length]);
  useEffect(() => {
    if (activeWorkspace && workerBees !== activeWorkspace.paneLayout) {
      updateWorkspace(activeWorkspace.id, { paneLayout: workerBees });
    }
  }, [workerBees]);
  useEffect(() => {
    const id = requestAnimationFrame(() => refitTerminals());
    return () => cancelAnimationFrame(id);
  }, [gridLayout, active, fullscreen]);

  useEffect(() => {
    invoke("detect_shells").then((s: any) => setShells(Array.isArray(s) ? s : [])).catch(() => {});
  }, []);

  // Shut down the shared CDP browser when no browser panes remain.
  const browserCount = workerBees.filter((b) => b.kind === "browser").length;
  useEffect(() => {
    if (browserCount === 0) invoke("stop_cdp_browser").catch(() => {});
  }, [browserCount]);

  /* ── plane items ────────────────────────────────────────────── */
  const items = workerBees.filter((b) => paneInPlane(b, plane));

  /* ── adds (into the active plane) ───────────────────────────── */
  const persist = (bee: WorkerBee) => {
    if (activeWorkspaceId) {
      const ws = workspaces.find((w) => w.id === activeWorkspaceId);
      if (ws) updateWorkspace(activeWorkspaceId, { paneLayout: [...ws.paneLayout, bee] });
    }
  };
  const addAgent = (cli: string, name: string) => {
    const bee: WorkerBee = { id: `bee-${Date.now()}`, cli, cliName: name };
    addWorkerBee(bee); setAgentStatus(bee.id, "launching"); persist(bee);
  };
  const addShell = (shell?: { label: string; command: string }) => {
    const bee: WorkerBee = {
      id: `terminal-${Date.now()}`, cli: shell?.command ?? "shell",
      cliName: shell?.label ?? "Terminal", kind: "shell",
    };
    addWorkerBee(bee); persist(bee);
  };
  const addBrowser = () => {
    const bee: WorkerBee = { id: `browser-${Date.now()}`, cli: "browser", cliName: "Browser", kind: "browser" };
    addWorkerBee(bee); persist(bee);
  };
  const addEmulator = () => {
    const bee: WorkerBee = { id: `emulator-${Date.now()}`, cli: "emulator", cliName: "Emulator", kind: "emulator" };
    addWorkerBee(bee); persist(bee);
  };
  const addOpenVsx = (ext?: { id: string; name: string; icon?: string }) => {
    const bee: WorkerBee = {
      id: `openvsx-${Date.now()}`, cli: "openvsx", cliName: ext?.name || "HiveExtension", kind: "openvsx",
      extensionId: ext?.id, iconUrl: ext?.icon,
    };
    addWorkerBee(bee); persist(bee);
  };

  const handleRemove = (id: string) => {
    invoke("kill_terminal", { paneId: id }).finally(() => removeWorkerBee(id));
  };
  const toggleMaximize = (id: string) => {
    setMaximizedPane(maximizedPane === id ? null : id);
    requestAnimationFrame(() => refitTerminals());
  };
  const startRename = (id: string) => {
    const bee = workerBees.find((b) => b.id === id);
    if (bee) { setEditingBee(id); setEditValue(bee.customName || bee.cliName); }
  };
  const saveRename = () => {
    if (editingBee) { updateWorkerBee(editingBee, { customName: editValue }); setEditingBee(null); setEditValue(""); }
  };
  const cancelRename = () => { setEditingBee(null); setEditValue(""); };

  /* ── grid sizing (scoped to this plane's items) ─────────────────
     Column presets (rows-per-page = 1): N columns, each row full plane
       height → panes stay big, scroll past N.
     Grid presets  (rows-per-page = M): N cols × M rows fill one screen;
       extra panes scroll below.
     Whenever the content overflows, all rows shrink by PEEK so the next
     row's titlebar peeks and the user knows to scroll (point 8).
     Row height is expressed in cqh (1% of the plane body's height — the body
     is a size container), so it's exact in both docked and fullscreen modes
     without measuring anything. */
  const GAP = 8;      // grid gap (gap-2)
  const PEEK = 34;    // peeked titlebar height when scrolling
  const count = items.length;
  const preset = presetFor(gridLayout);
  const colsFor = (): number => {
    if (count <= 1) return 1;
    if (preset) return Math.max(1, Math.min(preset.cols, count));
    switch (gridLayout) {
      case "rows": return 1;
      case "cols": return count;
      case "grid": return Math.ceil(Math.sqrt(count));
      case 1: case 2: case 3: case 4: return Math.min(gridLayout, count);
      default: return count <= 2 ? 2 : count <= 6 ? 3 : 4;
    }
  };
  const isMaster = gridLayout === "master" && !maximizedPane && count > 1;
  const focusMode = !!preset?.focus && !maximizedPane && count > 0;
  const focus4 = gridLayout === "focus4";
  // Focus renders on a 12-track grid (divisible by 3 and 4) so the spotlight +
  // side block up top and the 4-column overflow block below all line up.
  const cols = focusMode ? 12 : colsFor();

  // rows visible per screen, and how many rows the content actually needs.
  // Focus: 2 rows up top (spotlight height); panes 4+ overflow into a 4×2 grid
  // below (4 per row), scrolling.
  const rowsPerPage = focusMode ? 2 : preset?.rows ?? 1;
  const totalRows = focusMode
    ? 2 + Math.ceil(Math.max(0, count - 3) / 4)
    : Math.max(1, Math.ceil(count / cols));
  const overflow = totalRows > rowsPerPage;
  const subtract = (overflow ? PEEK : 0) + GAP * (rowsPerPage - 1);
  const rowVal = `max(140px, calc((100cqh - ${subtract}px) / ${rowsPerPage}))`;

  // Focus placement: spotlight (focused, else first) fills cols 1–2 (of the
  // preset's split); the next two panes fill the remaining top columns as full
  // rows; panes 4+ flow into a 4-wide grid below (each spans 3 of 12 tracks).
  const spotlightId = focusMode
    ? (items.some((b) => b.id === spotlightSel) ? spotlightSel : items[0]?.id)
    : null;
  const focusPlace = new Map<string, React.CSSProperties>();
  if (focusMode) {
    const split = focus4 ? 7 : 9; // spotlight occupies cols 1..split-1
    let c = 0; // index among non-spotlight panes
    for (const b of items) {
      if (b.id === spotlightId) {
        focusPlace.set(b.id, { gridColumn: `1 / ${split}`, gridRow: "1 / 3" });
      } else if (c === 0) {
        focusPlace.set(b.id, { gridColumn: `${split} / 13`, gridRow: "1" });
        c++;
      } else if (c === 1) {
        focusPlace.set(b.id, { gridColumn: `${split} / 13`, gridRow: "2" });
        c++;
      } else {
        const k = c - 2;
        focusPlace.set(b.id, { gridColumn: `${1 + (k % 4) * 3} / span 3`, gridRow: `${3 + Math.floor(k / 4)}` });
        c++;
      }
    }
  }

  const gridStyle = maximizedPane
    ? { gridTemplateColumns: "1fr", gridTemplateRows: "1fr", height: "100%" }
    : isMaster
    ? { gridTemplateColumns: "1.7fr 1fr", gridTemplateRows: `repeat(${count - 1}, minmax(180px, 1fr))`, gridAutoFlow: "row" as const }
    : preset
    ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: rowVal }
    : { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: "minmax(240px, 1fr)" };

  const Icon = PLANE_ICON[active];

  // Chips for the HoneyFlow strip — one per open component.
  const stripItems: StripItem[] = items.map((b) => ({
    id: b.id,
    name: b.customName || b.cliName,
    kind: b.kind ?? "agent",
    icon: paneIconNode(b),
  }));

  return (
    <div
      ref={rootRef}
      className={
        fullscreen
          ? "fixed inset-0 z-[100] flex flex-col bg-bee-canvas"
          : "flex-1 flex flex-col bg-bee-canvas/40 relative min-w-0"
      }
    >
      {/* ── Board header ──────────────────────────────────────────────
          HoneyFlow shows a strip of open-component chips + the add button (and
          the app logo when maximized). Other planes keep a plain labelled bar.
          relative z-30: panes use backdrop-blur (own stacking contexts), so
          without this the add dropdown paints *behind* them. */}
      {active === "honeyflow" ? (
        <div className="relative z-30 shrink-0">
          <HoneyFlowStrip
            items={stripItems}
            activeId={spotlightSel ?? focusedPane}
            showLogo={fullscreen}
            onSelect={(id) => {
              // Only scroll to + highlight the pane — do NOT move the Focus
              // spotlight. Spotlight changes exclusively via drag-swap.
              setFocusedPane(id);
              rootRef.current?.querySelector(`[data-pane-id="${id}"]`)?.scrollIntoView({ block: "nearest" });
            }}
            onClose={(id) => handleRemove(id)}
            onAdd={() => setShowAdd((v) => !v)}
            fullscreen={fullscreen}
            onToggleFullscreen={toggleFullscreen}
            logoNode={<HiveoryLogo size={20} className="shrink-0" />}
          />
          {showAdd && (
            <div className="absolute left-2 top-full z-50">
              <PlaneAddMenu
                plane={plane}
                shells={shells}
                onAgent={(id, name) => { addAgent(id, name); setShowAdd(false); }}
                onShell={(s) => { addShell(s); setShowAdd(false); }}
                onBrowser={() => { addBrowser(); setShowAdd(false); }}
                onEmulator={() => { addEmulator(); setShowAdd(false); }}
                onOpenVsx={(ext) => { addOpenVsx(ext); setShowAdd(false); }}
                onClose={() => setShowAdd(false)}
              />
            </div>
          )}
        </div>
      ) : (
        <div className="relative z-30 flex h-9 shrink-0 items-center gap-2 border-b border-bee-border/50 glass-toolbar px-2.5">
          {fullscreen && <HiveoryLogo size={20} className="shrink-0" />}
          <Icon className="size-3.5 shrink-0 text-bee-gold" />
          <span className="text-xs font-semibold text-bee-text">{plane.label}</span>
          <span className="text-[10px] text-bee-textMuted">{count > 0 ? `${count} open` : ""}</span>

          <div className="relative ml-1">
            <button
              onClick={() => setShowAdd((v) => !v)}
              className="flex items-center gap-0.5 rounded-md border border-bee-gold/25 bg-bee-gold/10 px-1.5 py-0.5 text-[10px] font-medium text-bee-goldHi transition-colors hover:bg-bee-gold/20"
              title={`Add to ${plane.label}`}
            >
              <Plus className="size-3" />
            </button>
            {showAdd && (
              <PlaneAddMenu
                plane={plane}
                shells={shells}
                onAgent={(id, name) => { addAgent(id, name); setShowAdd(false); }}
                onShell={(s) => { addShell(s); setShowAdd(false); }}
                onBrowser={() => { addBrowser(); setShowAdd(false); }}
                onEmulator={() => { addEmulator(); setShowAdd(false); }}
                onOpenVsx={(ext) => { addOpenVsx(ext); setShowAdd(false); }}
                onClose={() => setShowAdd(false)}
              />
            )}
          </div>

          <div className="ml-auto">
            <button
              onClick={toggleFullscreen}
              className="rounded p-1 text-bee-textMuted transition-colors hover:bg-black/20 hover:text-bee-text"
              title={fullscreen ? "Restore" : "Maximize plane"}
            >
              {fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
            </button>
          </div>
        </div>
      )}

      {/* ── Drag-to-top snap picker ──────────────────────────────────
          While a pane is being dragged, a Windows-snap-style strip sits at
          the top; moving the cursor onto a tile highlights it and releasing
          applies that grid. Hit-testing is geometric (see hitTest) so it also
          works over terminal/webview panes and in fullscreen. */}
      {drag && (
        <div className="pointer-events-none absolute inset-x-0 top-9 z-[60] flex justify-center px-4 pt-3">
          <div className="flex items-end gap-2 rounded-2xl border border-bee-border/60 bg-bee-surface/95 px-4 py-3 shadow-2xl shadow-black/50 backdrop-blur-md animate-fade-in">
            {GRID_PRESETS.map((p) => {
              const hot = over?.kind === "snap" && over.id === p.id;
              return (
                <div
                  key={p.id}
                  data-snap={p.id}
                  className={`flex flex-col items-center gap-1 rounded-lg px-2 py-1.5 transition-colors ${
                    hot ? "bg-bee-gold/20 scale-105" : ""
                  }`}
                >
                  <PresetThumb cols={p.cols} rows={p.rows ?? 1} focus={p.focus} focusWide={p.id === "focus4"} active={hot || gridLayout === p.id} size={46} />
                  <span className={`text-[10px] font-medium ${hot ? "text-bee-goldHi" : "text-bee-textMuted"}`}>{p.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Plane body (size container so grid rows can use cqh) ───── */}
      <div
        style={{ containerType: "size" }}
        className="flex-1 min-h-0 p-2 overflow-auto scrollbar-sleek"
        onWheel={(e) => {
          if (!e.shiftKey) return;
          const el = e.currentTarget;
          if (el.scrollHeight > el.clientHeight) el.scrollTop += e.deltaY;
          else if (el.scrollWidth > el.clientWidth) el.scrollLeft += e.deltaY;
        }}
      >
        {count === 0 ? (
          <PlaneEmpty plane={plane} onAdd={() => setShowAdd(true)} />
        ) : (
          <div className="grid gap-2" style={gridStyle}>
            {items.map((bee) => {
              const isThisMax = maximizedPane === bee.id;
              const shouldHide = maximizedPane !== null && !isThisMax;
              return (
                <div
                  key={bee.id}
                  data-pane-id={bee.id}
                  onMouseDown={(e) => onPaneMouseDown(e, bee)}
                  onFocusCapture={() => setFocusedPane(bee.id)}
                  onBlurCapture={() => setFocusedPane((cur) => (cur === bee.id ? null : cur))}
                  className={`flex flex-col overflow-hidden glass shadow-glass hover:shadow-glass-lg ${
                    isThisMax
                      ? "fixed left-0 right-0 top-11 bottom-6 z-50 rounded-none shadow-2xl shadow-black/60"
                      : shouldHide
                      ? "hidden"
                      : "relative h-full rounded-lg border-t-2 transition-all duration-300"
                  } ${drag?.id === bee.id ? "opacity-30 scale-[0.98]" : ""} ${
                    over?.kind === "pane" && over.id === bee.id ? "ring-2 ring-bee-gold/70" : ""
                  } ${focusedPane === bee.id && !isThisMax ? "pane-active" : ""}`}
                  style={!isThisMax && !shouldHide ? {
                    // Per-component accent: WorkerBees gold, terminals blade.
                    // Brighter while a drop is hovering it.
                    borderTopColor: over?.kind === "pane" && over.id === bee.id
                      ? themeForKind(bee.kind).accent
                      : themeForKind(bee.kind).border,
                    ...(focusMode ? focusPlace.get(bee.id) : null),
                  } : undefined}
                >
                  {bee.kind === "emulator" ? (
                    <EmulatorPane onClose={() => handleRemove(bee.id)} onToggleMaximize={() => toggleMaximize(bee.id)} isMaximized={isThisMax} />
                  ) : bee.kind === "openvsx" ? (
                    <OpenVsxPane paneId={bee.id} workingDir={workingDir} tabName={bee.customName || bee.cliName} extensionId={bee.extensionId} onClose={() => handleRemove(bee.id)} onToggleMaximize={() => toggleMaximize(bee.id)} isMaximized={isThisMax} />
                  ) : bee.kind === "browser" ? (
                    <BrowserPane paneId={bee.id} initialUrl={bee.url} onClose={() => handleRemove(bee.id)} onToggleMaximize={() => toggleMaximize(bee.id)} isMaximized={isThisMax} />
                  ) : bee.kind === "shell" ? (
                    <TerminalPane
                      paneId={bee.id} workingDir={workingDir}
                      tabName={bee.customName || bee.cliName}
                      shellCommand={bee.cli !== "shell" ? bee.cli : undefined}
                      shellLabel={bee.cliName}
                      onRename={editingBee === bee.id ? saveRename : () => startRename(bee.id)}
                      isEditing={editingBee === bee.id} editValue={editValue}
                      onEditChange={setEditValue} onCancelRename={cancelRename}
                      onClose={() => handleRemove(bee.id)} onToggleMaximize={() => toggleMaximize(bee.id)} isMaximized={isThisMax}
                    />
                  ) : (
                    <WorkerBeePane
                      paneId={bee.id} workingDir={workingDir} workerBee={bee}
                      onRename={editingBee === bee.id ? saveRename : () => startRename(bee.id)}
                      isEditing={editingBee === bee.id} editValue={editValue}
                      onEditChange={setEditValue} onCancelRename={cancelRename}
                      onClose={() => handleRemove(bee.id)} onToggleMaximize={() => toggleMaximize(bee.id)} isMaximized={isThisMax}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Drag ghost — a small label chip following the cursor while dragging. */}
      {drag && (
        <div
          className="pointer-events-none fixed z-[70] flex items-center gap-1.5 rounded-lg border border-bee-gold/50 bg-bee-surface/95 px-2.5 py-1 text-[11px] font-medium text-bee-goldHi shadow-xl shadow-black/50"
          style={{ left: pointer.x + 14, top: pointer.y + 14 }}
        >
          <Icon className="size-3.5" />
          {drag.name}
        </div>
      )}

      {/* Fullscreen hides the docked Task Comb + QueenBee dock, so offer both as
          floating widgets: QueenBee bottom-right, Task Comb bottom-left. */}
      {fullscreen && (
        <FullscreenWidgets
          tasks={activeWorkspace?.taskCards ?? []}
          statuses={agentStatuses}
        />
      )}
    </div>
  );
}

/* ── plane switcher for the title bar ─────────────────────────── */
export function PlaneSwitcher() {
  const active = usePlaneStore((s) => s.active);
  const setActive = usePlaneStore((s) => s.setActive);
  const workerBees = useWorkerBeesStore((s) => s.workerBees);
  return (
    <div className="flex items-center gap-0.5 rounded-lg glass border-bee-border/70 p-0.5">
      {PLANES.map((p) => {
        const Icon = PLANE_ICON[p.kind];
        const n = workerBees.filter((b) => paneInPlane(b, p)).length;
        const isActive = active === p.kind;
        return (
          <button
            key={p.kind}
            onClick={() => setActive(p.kind)}
            title={p.label}
            className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
              isActive
                ? "bg-bee-gold/15 text-bee-goldHi"
                : "text-bee-textMuted hover:text-bee-text"
            }`}
          >
            <Icon className="size-3.5" />
            <span className="hidden md:inline">{p.label}</span>
            {n > 0 && (
              <span className="rounded-full bg-bee-gold/20 px-1 text-[9px] text-bee-gold">{n}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ── add menu ─────────────────────────────────────────────────── */
function PlaneAddMenu({
  plane, shells, onAgent, onShell, onBrowser, onEmulator, onOpenVsx, onClose,
}: {
  plane: PlaneDef;
  shells: { id: string; label: string; command: string }[];
  onAgent: (id: string, name: string) => void;
  onShell: (s: { label: string; command: string }) => void;
  onBrowser: () => void;
  onEmulator: () => void;
  onOpenVsx: (ext: { id: string; name: string; icon?: string }) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const extensions = useExtensionStore((s) => s.installed);
  const has = (s: string) => s.toLowerCase().includes(q.toLowerCase());

  // Board menu: unified gold theme, a search box, top 4 per category.
  if (plane.kind === "honeyflow") {
    const agents = CLI_METADATA.filter((c) => has(c.name) || has(c.command)).slice(0, 4);
    const terms = shells.filter((s) => has(s.label)).slice(0, 4);
    const exts = extensions.filter((e) => has(e.name) || has(e.publisher)).slice(0, 4);
    return (
      <>
        <div className="fixed inset-0 z-40" onClick={onClose} />
        <div className="absolute left-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-xl glass-hi p-1.5 animate-fade-in">
          <div className="mb-1 flex h-7 items-center gap-1.5 rounded-md border border-bee-border/60 bg-bee-canvas/60 px-2 focus-within:border-bee-gold/50">
            <Search className="size-3 text-bee-textMuted" />
            <input
              autoFocus value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Search components…"
              className="min-w-0 flex-1 bg-transparent text-[11px] text-bee-text outline-none placeholder:text-bee-textMuted/60"
            />
          </div>
          <div className="max-h-[60vh] overflow-y-auto scrollbar-sleek">
            {terms.length > 0 && <MenuLabel>Terminals</MenuLabel>}
            {terms.map((s) => (
              <MenuItem key={s.id} onClick={() => onShell(s)} icon={shellIcon(s.label)} title={s.label} />
            ))}
            {agents.length > 0 && <MenuLabel>WorkerBees</MenuLabel>}
            {agents.map((c) => (
              // Spawn by the shell command ("claude"), not the slug id.
              <MenuItem key={c.id} onClick={() => onAgent(c.command, c.name)}
                icon={CLI_ICON[c.id] ?? Bot} title={c.name} subtitle={c.command} />
            ))}
            {exts.length > 0 && <MenuLabel>Extensions</MenuLabel>}
            {exts.map((e) => (
              <MenuItem key={e.id} onClick={() => onOpenVsx({ id: e.id, name: e.name, icon: e.icon })}
                iconNode={e.icon ? <img src={e.icon} alt="" className="size-4 rounded-sm object-contain" /> : undefined}
                icon={Blocks} title={e.name} subtitle={e.publisher} />
            ))}
            {terms.length + agents.length + exts.length === 0 && (
              <div className="px-2.5 py-3 text-center text-[11px] text-bee-textMuted">No matches.</div>
            )}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute left-0 top-full z-50 mt-1 max-h-[70vh] min-w-52 overflow-y-auto scrollbar-sleek rounded-xl glass-hi p-1 animate-fade-in">
        {plane.kind === "browser" && (
          <MenuItem onClick={onBrowser} icon={Globe} title="New browser pane" subtitle="localhost preview" />
        )}
        {plane.kind === "emulator" && (
          <MenuItem onClick={onEmulator} icon={Smartphone} title="New emulator pane" subtitle="Android AVDs" />
        )}
      </div>
    </>
  );
}

function MenuLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-bee-gold">{children}</div>;
}
function MenuItem({ onClick, title, subtitle, icon: Icon = Plus, iconNode }: { onClick: () => void; title: string; subtitle?: string; icon?: typeof Bot; iconNode?: React.ReactNode }) {
  return (
    <button onClick={onClick} className="flex w-full items-start gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-bee-textDim transition-colors hover:bg-bee-border/50 hover:text-bee-text">
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-bee-gold">
        {iconNode ?? <Icon className="size-3.5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{title}</span>
        {subtitle && <span className="block truncate text-[9px] text-bee-textMuted">{subtitle}</span>}
      </span>
    </button>
  );
}

/* ── empty + placeholder states ───────────────────────────────── */
function PlaneEmpty({ plane, onAdd }: { plane: PlaneDef; onAdd: () => void }) {
  const Icon = PLANE_ICON[plane.kind];
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center animate-fade-in">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-bee-gold/10">
        <Icon className="size-6 text-bee-gold" />
      </div>
      <div className="text-sm font-medium text-bee-textDim">No {plane.label.toLowerCase()} open</div>
      <button
        onClick={onAdd}
        className="rounded-lg border border-bee-gold/25 bg-bee-gold/10 px-3 py-1 text-[11px] font-medium text-bee-goldHi transition-colors hover:bg-bee-gold/20"
      >
        Add {plane.label}
      </button>
    </div>
  );
}

/* ── floating widgets shown when a plane is fullscreen ────────── */
function FullscreenWidgets({ tasks, statuses }: { tasks: TaskCard[]; statuses: Record<string, string> }) {
  const [open, setOpen] = useState<"none" | "queen" | "comb">("none");
  return (
    <>
      {/* Task Comb — bottom-left */}
      {open === "comb" && (
        <div className="fixed bottom-16 left-4 z-[120] flex h-[46vh] w-[min(560px,60vw)] flex-col overflow-hidden rounded-xl border border-bee-border/60 bg-bee-surface shadow-2xl shadow-black/60 animate-fade-in">
          <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-bee-border/40 glass-toolbar px-2.5">
            <Columns3 className="size-3 text-bee-gold" />
            <span className="text-[11px] font-semibold text-bee-text">Task Comb</span>
            <button onClick={() => setOpen("none")} className="ml-auto rounded p-0.5 text-bee-textMuted hover:bg-bee-border/40 hover:text-bee-text">
              <X className="size-3" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <PipelineBoard open tasks={tasks} statuses={statuses} onClose={() => setOpen("none")} />
          </div>
        </div>
      )}

      {/* QueenBee — bottom-right */}
      {open === "queen" && (
        <div className="fixed bottom-16 right-4 z-[120] flex h-[56vh] w-[min(400px,44vw)] flex-col overflow-hidden rounded-xl border border-bee-border/60 shadow-2xl shadow-black/60 animate-fade-in">
          <QueenBeeChat docked onToggleDock={() => setOpen("none")} />
        </div>
      )}

      {/* Corner toggles (always visible in fullscreen) */}
      <button
        onClick={() => setOpen((o) => (o === "comb" ? "none" : "comb"))}
        className={`fixed bottom-4 left-4 z-[121] flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium shadow-lg transition-colors ${
          open === "comb"
            ? "border-bee-gold/50 bg-bee-gold/20 text-bee-goldHi"
            : "border-bee-border/60 bg-bee-surface/90 text-bee-textDim hover:text-bee-text"
        }`}
        title="Task Comb"
      >
        <Columns3 className="size-3.5" />
        Task Comb
      </button>
      <button
        onClick={() => setOpen((o) => (o === "queen" ? "none" : "queen"))}
        className={`fixed bottom-4 right-4 z-[121] flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium shadow-lg transition-colors ${
          open === "queen"
            ? "border-bee-gold/50 bg-bee-gold/20 text-bee-goldHi"
            : "border-bee-border/60 bg-bee-surface/90 text-bee-textDim hover:text-bee-text"
        }`}
        title="Ask QueenBee"
      >
        <QueenCrown className="size-3.5" />
        QueenBee
      </button>
    </>
  );
}
