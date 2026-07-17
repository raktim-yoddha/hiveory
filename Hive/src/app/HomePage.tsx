"use client";

import { useState, useEffect, useRef } from "react";
import WorkerBeesPanel from "@/features/worker-bees/WorkerBeesPanel";
import type { CLIType } from "@/features/worker-bees/cli-types";
import { CLI_METADATA } from "@hiveory/worker-bees";
import SettingsPage from "@/features/settings/SettingsPage";
import { useWorkerBeesStore, WorkerBee } from "@/features/worker-bees/workerBeesStore";
import { getTauriAPIs, loadTauriAPIs } from "@/shared/tauri";
import ADEWorktreeSidebar from "@/features/workspaces/WorkspacesSidebar";
import ADERightDock from "@/features/dock/RightDock";
import { useWorkspaceStore } from "@/features/workspaces/workspaceStore";
import { useProjectStore } from "@/shared/projectStore";
import { useUiStore } from "@/shared/uiStore";
import {
  Settings,
  Bot,
  X,
  Minus,
  Square,
  Copy,
  Terminal as TerminalIcon,
  ChevronDown,
  FolderOpen,
  GitBranch,
  PanelLeft,
  PanelRight,
  Columns3,
  Grid2x2,
  Rows3,
  LayoutPanelLeft,
  Sparkles,
  Columns2,
  Columns4,
  Globe,
  type LucideIcon,
} from "lucide-react";

import type { GridLayout } from "@/features/worker-bees/workerBeesStore";

const LAYOUT_OPTIONS: {
  value: GridLayout;
  label: string;
  hint: string;
  icon: LucideIcon;
}[] = [
  { value: "auto",   label: "Auto",      hint: "Fit to pane count", icon: Sparkles },
  { value: "grid",   label: "Grid",      hint: "Balanced grid",     icon: Grid2x2 },
  { value: "rows",   label: "Rows",      hint: "Stacked",           icon: Rows3 },
  { value: "master", label: "Spotlight", hint: "Focus + stack",     icon: LayoutPanelLeft },
  { value: 2, label: "2 Columns", hint: "Fixed", icon: Columns2 },
  { value: 3, label: "3 Columns", hint: "Fixed", icon: Columns3 },
  { value: 4, label: "4 Columns", hint: "Fixed", icon: Columns4 },
];

export default function HomePage() {
  const [initialized, setInitialized] = useState(false);
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [gitStatus, setGitStatus] = useState<{
    branch: string;
    changed: number;
  } | null>(null);
  const windowRef = useRef<any>(null);

  // Sidebar state: pinned = takes flex space, unpinned = overlay.
  // Open/closed lives in uiStore so QueenBee's tools can toggle it too.
  const [leftPinned, setLeftPinned] = useState(true);
  const [rightPinned, setRightPinned] = useState(true);
  const leftOpen = useUiStore((s) => s.leftOpen);
  const rightOpen = useUiStore((s) => s.rightOpen);
  const setLeftOpen = useUiStore((s) => s.setLeftOpen);
  const setRightOpen = useUiStore((s) => s.setRightOpen);
  const toggleLeft = useUiStore((s) => s.toggleLeft);
  const toggleRight = useUiStore((s) => s.toggleRight);

  const workerBees = useWorkerBeesStore((state) => state.workerBees);
  const addWorkerBee = useWorkerBeesStore((state) => state.addWorkerBee);
  const setAgentStatus = useWorkerBeesStore((state) => state.setAgentStatus);
  const gridLayout = useWorkerBeesStore((state) => state.gridLayout);
  const setGridLayout = useWorkerBeesStore((state) => state.setGridLayout);
  const refitTerminals = useWorkerBeesStore((state) => state.refitTerminals);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const updateWorkspace = useWorkspaceStore((s) => s.updateWorkspace);
  const boardOpen = useWorkspaceStore((s) => s.boardOpen);
  const setBoardOpen = useWorkspaceStore((s) => s.setBoardOpen);

  useEffect(() => {
    const id = requestAnimationFrame(() => refitTerminals());
    return () => cancelAnimationFrame(id);
  }, []);

  const [showCLIPicker, setShowCLIPicker] = useState(false);

  // Detected shells for the Terminal launcher dropdown.
  const [detectedShells, setDetectedShells] = useState<{ id: string; label: string; command: string }[]>([]);
  const [showTermMenu, setShowTermMenu] = useState(false);
  const [showLayoutMenu, setShowLayoutMenu] = useState(false);
  useEffect(() => {
    const apis = getTauriAPIs();
    if (!apis?.invoke) return;
    apis.invoke("detect_shells")
      .then((s: any) => setDetectedShells(Array.isArray(s) ? s : []))
      .catch(() => setDetectedShells([]));
  }, []);

  useEffect(() => {
    const initializeWindow = async () => {
      try {
        const apis = await loadTauriAPIs();
        if (apis?.getCurrentWindow) {
          const window = apis.getCurrentWindow();
          windowRef.current = window;
        }
      } catch (e) {
        console.error("Failed to initialize window:", e);
      }
    };
    initializeWindow();
    setInitialized(true);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "b") {
        e.preventDefault();
        toggleRight();
      }
    };

    // Dropdowns close via their own click-catcher overlay.
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleMinimize = async () => {
    try {
      const apis = getTauriAPIs();
      if (apis?.getCurrentWindow) {
        const window = apis.getCurrentWindow();
        if (window) await window.minimize();
      }
    } catch (e) {
      console.error("Failed to minimize window:", e);
    }
  };

  const handleMaximize = async () => {
    try {
      const apis = getTauriAPIs();
      if (apis?.getCurrentWindow) {
        const window = apis.getCurrentWindow();
        if (window) {
          if (isMaximized) {
            await window.unmaximize();
            setIsMaximized(false);
          } else {
            await window.maximize();
            setIsMaximized(true);
          }
        }
      }
    } catch (e) {
      console.error("Failed to toggle maximize:", e);
    }
  };

  const handleClose = async () => {
    try {
      const apis = getTauriAPIs();
      if (apis?.getCurrentWindow) {
        const window = apis.getCurrentWindow();
        if (window) await window.close();
      }
    } catch (e) {
      console.error("Failed to close window:", e);
    }
  };

  const handleTitleBarDoubleClick = async () => {
    await handleMaximize();
  };

  const handleFolderSelect = async (folderPath: string) => {
    setProjectPath(folderPath);
    useProjectStore.getState().setProjectPath(folderPath); // keep the shared store in sync for QueenBee tools/dispatch
    try {
      const apis = getTauriAPIs();
      if (apis?.invoke) {
        await apis.invoke("ensure_nectar_structure", { projectPath: folderPath });
      }
    } catch (e) {
      console.error("Failed to initialize Nectar for folder:", e);
    }
  };

  const handleOpenFolder = async () => {
    try {
      const apis = getTauriAPIs();
      if (!apis?.open) return;
      const folderPath = await apis.open({ directory: true, multiple: false, title: "Open Folder" });
      if (folderPath && typeof folderPath === "string") {
        await handleFolderSelect(folderPath);
      }
    } catch (e) {
      console.error("Failed to open folder:", e);
    }
  };

  useEffect(() => {
    if (!projectPath) { setGitStatus(null); return; }
    let cancelled = false;
    const fetchStatus = async () => {
      try {
        const apis = getTauriAPIs();
        if (!apis?.invoke) return;
        const status = await apis.invoke<{ branch: string; changed: number }>("git_status", { projectPath });
        if (!cancelled) setGitStatus(status);
      } catch { if (!cancelled) setGitStatus(null); }
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [projectPath]);

  const handleCLISelect = (cli: CLIType) => {
    const meta = CLI_METADATA.find((c) => c.id === cli);
    const newWorkerBee: WorkerBee = {
      id: `workerbee-${Date.now()}`,
      cli: meta?.command ?? cli,
      cliName: meta?.name ?? cli,
    };

    addWorkerBee(newWorkerBee);
    setAgentStatus(newWorkerBee.id, "launching");

    if (activeWorkspaceId) {
      const ws = workspaces.find((w) => w.id === activeWorkspaceId);
      if (ws) {
        updateWorkspace(activeWorkspaceId, {
          paneLayout: [...ws.paneLayout, newWorkerBee],
        });
      }
    }
  };

  // Open a CDP-driven browser pane (localhost preview, agent-readable screenshots).
  const handleAddBrowser = () => {
    const pane: WorkerBee = {
      id: `browser-${Date.now()}`,
      cli: "browser",
      cliName: "Browser",
      kind: "browser",
    };
    addWorkerBee(pane);
    if (activeWorkspaceId) {
      const ws = workspaces.find((w) => w.id === activeWorkspaceId);
      if (ws) updateWorkspace(activeWorkspaceId, { paneLayout: [...ws.paneLayout, pane] });
    }
  };

  // Open a plain shell terminal pane (not a CLI agent) running the chosen shell.
  const handleAddTerminal = (shell?: { label: string; command: string }) => {
    setShowTermMenu(false);
    const terminal: WorkerBee = {
      id: `terminal-${Date.now()}`,
      cli: shell?.command ?? "shell",
      cliName: shell?.label ?? "Terminal",
      kind: "shell",
    };
    addWorkerBee(terminal);
    if (activeWorkspaceId) {
      const ws = workspaces.find((w) => w.id === activeWorkspaceId);
      if (ws) updateWorkspace(activeWorkspaceId, { paneLayout: [...ws.paneLayout, terminal] });
    }
  };

  const activeLayout =
    LAYOUT_OPTIONS.find((o) => o.value === gridLayout) ?? LAYOUT_OPTIONS[0];

  // Pinned sidebars take flex space (docked); unpinned float over the content.
  const leftTakesSpace = leftPinned && leftOpen;
  // Right dock always reserves space when open — floating it over the center
  // buried the Mission Pipeline's right edge under the panel.
  const rightTakesSpace = rightOpen;

  return (
    <div className="h-screen w-screen flex flex-col text-bee-text font-sans select-none">
      {/* Unified Title Bar */}
      <div
        className="relative z-50 h-11 glass-toolbar flex items-center px-3 border-b border-bee-border/60"
        data-tauri-drag-region
        onDoubleClick={handleTitleBarDoubleClick}
      >
        {/* Left section — sidebar toggles */}
        <div className="flex items-center gap-1 mr-3">
          <button
            onClick={() => toggleLeft()}
            className={`p-1.5 rounded-md transition-colors ${
              leftOpen
                ? "text-bee-goldHi bg-bee-gold/10"
                : "text-bee-textMuted hover:text-bee-text hover:bg-bee-border/40"
            }`}
            title="Toggle workspace sidebar"
          >
            <PanelLeft size={16} />
          </button>
          <button
            onClick={() => setBoardOpen(!boardOpen)}
            className={`p-1.5 rounded-md transition-colors ${
              boardOpen
                ? "text-bee-goldHi bg-bee-gold/10"
                : "text-bee-textMuted hover:text-bee-text hover:bg-bee-border/40"
            }`}
            title="Toggle kanban board"
          >
            <Columns3 size={16} />
          </button>
        </div>

        {/* Center section — branding + controls */}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-gradient-to-br from-bee-goldHi to-bee-goldDim rounded-lg flex items-center justify-center text-[10px] font-bold text-[#1a1200] shadow-glow">
              H
            </div>
            <span className="text-xs font-semibold tracking-tight text-bee-text hidden sm:inline">
              Hiveory<span className="text-bee-gold">AI</span>
            </span>
          </div>

          <span className="text-[11px] font-medium text-bee-gold bg-bee-gold/10 border border-bee-gold/20 px-2 py-0.5 rounded-full flex-shrink-0">
            {workerBees.length}
          </span>

          <button
            onClick={handleOpenFolder}
            className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] glass border-bee-border/70 text-bee-textDim hover:text-bee-text transition-colors min-w-0 flex-shrink"
            title={projectPath || "Open a project folder"}
          >
            <FolderOpen size={11} className="text-bee-gold flex-shrink-0" />
            <span className="truncate max-w-[120px]">
              {projectPath ? projectPath.split(/[\\/]/).filter(Boolean).pop() : "Open Project"}
            </span>
          </button>

          <div className="relative flex-shrink-0">
            <button
              onClick={() => setShowLayoutMenu((v) => !v)}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] glass border-bee-border/70 text-bee-textDim hover:text-bee-text transition-colors"
              title="Pane layout"
            >
              <activeLayout.icon size={12} className="text-bee-gold" />
              <span className="hidden sm:inline">{activeLayout.label}</span>
              <ChevronDown size={10} className="text-bee-textMuted" />
            </button>
            {showLayoutMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowLayoutMenu(false)} />
                <div className="absolute left-0 top-full mt-1 z-50 min-w-48 glass-hi rounded-xl p-1 animate-fade-in">
                  <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-bee-gold font-semibold">
                    Pane layout
                  </div>
                  {LAYOUT_OPTIONS.map((opt) => {
                    const Icon = opt.icon;
                    const active = gridLayout === opt.value;
                    return (
                      <button
                        key={opt.label}
                        onClick={() => { setGridLayout(opt.value); setShowLayoutMenu(false); }}
                        className={`w-full px-2.5 py-1.5 text-left text-xs rounded-lg flex items-center gap-2 transition-colors ${
                          active
                            ? "bg-bee-gold/10 text-bee-goldHi"
                            : "text-bee-textDim hover:bg-bee-border/50 hover:text-bee-text"
                        }`}
                      >
                        <Icon size={12} className={active ? "text-bee-gold" : "text-bee-textMuted"} />
                        <span className="flex-1">{opt.label}</span>
                        <span className="text-[9px] text-bee-textMuted">{opt.hint}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* WorkerBee launcher — same dropdown pattern as Terminal. */}
          <div className="relative flex-shrink-0">
            <button
              onClick={() => setShowCLIPicker((v) => !v)}
              className="flex items-center gap-1 rounded-lg border border-bee-gold/20 bg-bee-gold/10 px-2 py-1 text-[11px] text-bee-goldHi transition-colors hover:bg-bee-gold/20"
              title="Launch a WorkerBee (CLI agent)"
            >
              <Bot size={12} />
              <span className="hidden sm:inline">WorkerBee</span>
              <ChevronDown size={10} className="text-bee-goldHi/70" />
            </button>
            {showCLIPicker && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowCLIPicker(false)} />
                <div className="absolute left-0 top-full z-50 mt-1 max-h-[70vh] min-w-56 overflow-y-auto scrollbar-sleek rounded-xl glass-hi p-1 animate-fade-in">
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-bee-gold">
                    CLI agents
                  </div>
                  {CLI_METADATA.map((cli) => (
                    <button
                      key={cli.id}
                      onClick={() => { handleCLISelect(cli.id as CLIType); setShowCLIPicker(false); }}
                      className="flex w-full items-start gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-bee-textDim transition-colors hover:bg-bee-border/50 hover:text-bee-text"
                    >
                      <Bot size={11} className="mt-0.5 shrink-0 text-bee-gold" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{cli.name}</span>
                        <span className="block truncate text-[9px] text-bee-textMuted">{cli.command}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <button
            onClick={handleAddBrowser}
            className="flex flex-shrink-0 items-center gap-1 rounded-lg border border-bee-border bg-bee-canvas/60 px-2 py-1 text-[11px] text-bee-textDim transition-colors hover:border-bee-gold/60 hover:text-bee-text"
            title="Open a browser pane (localhost preview + agent screenshots)"
          >
            <Globe size={12} />
            <span className="hidden sm:inline">Browser</span>
          </button>

          <div className="relative flex-shrink-0">
            <button
              onClick={() => setShowTermMenu((v) => !v)}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] bg-bee-canvas/60 border border-bee-border text-bee-textDim hover:text-bee-text hover:border-bee-gold/60 transition-colors"
              title="Open a shell terminal"
            >
              <TerminalIcon size={12} />
              <span className="hidden sm:inline">Terminal</span>
              <ChevronDown size={10} className="text-bee-textMuted" />
            </button>
            {showTermMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowTermMenu(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 min-w-44 glass-hi rounded-xl p-1 animate-fade-in">
                  <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-bee-gold font-semibold">Detected shells</div>
                  {detectedShells.length === 0 ? (
                    <div className="px-2.5 py-2 text-[11px] text-bee-textMuted">Detecting…</div>
                  ) : (
                    detectedShells.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => handleAddTerminal(s)}
                        className="w-full px-2.5 py-1.5 text-left text-xs rounded-lg flex items-center gap-2 text-bee-textDim hover:bg-bee-border/50 hover:text-bee-text transition-colors"
                      >
                        <TerminalIcon size={11} className="text-bee-gold" />
                        {s.label}
                      </button>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right section — right sidebar toggle + window controls */}
        <div className="flex items-center gap-1 ml-3">
          <button
            onClick={() => toggleRight()}
            className={`p-1.5 rounded-md transition-colors ${
              rightOpen
                ? "text-bee-goldHi bg-bee-gold/10"
                : "text-bee-textMuted hover:text-bee-text hover:bg-bee-border/40"
            }`}
            title="Toggle right panel"
          >
            <PanelRight size={16} />
          </button>

          <div className="w-px h-4 bg-bee-border/40 mx-1" />
          <button
            onClick={() => setShowSettings(true)}
            className="p-1.5 rounded-md hover:bg-bee-border/60 text-bee-textMuted hover:text-bee-text transition-colors"
            title="CLI Agent API Keys"
          >
            <Settings size={14} />
          </button>
          <button
            onClick={handleMinimize}
            className="p-1.5 rounded-md hover:bg-bee-border/60 text-bee-textMuted hover:text-bee-text transition-colors"
            title="Minimize"
          >
            <Minus size={14} />
          </button>
          <button
            onClick={handleMaximize}
            className="p-1.5 rounded-md hover:bg-bee-border/60 text-bee-textMuted hover:text-bee-text transition-colors"
            title={isMaximized ? "Restore" : "Maximize"}
          >
            {isMaximized ? <Copy size={14} /> : <Square size={14} />}
          </button>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-md hover:bg-bee-err/80 text-bee-textMuted hover:text-white transition-colors"
            title="Close"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Main Content — position:relative so floating (unpinned) sidebars anchor
          here, below the title bar, instead of sliding up behind it. */}
      <div className="relative flex-1 flex overflow-hidden">
        {/* Left sidebar — docked (takes space) when pinned, floating overlay when unpinned */}
        {leftOpen && (
          <div className={`${leftTakesSpace ? "relative flex-shrink-0" : "absolute left-0 top-0 bottom-0 z-40 shadow-2xl shadow-black/40"}`}>
            <ADEWorktreeSidebar
              pinned={leftPinned}
              onTogglePin={() => setLeftPinned((p) => !p)}
              onClose={() => setLeftOpen(false)}
            />
          </div>
        )}

        {/* Main grid area — min-w-0 allows flex to shrink below children's intrinsic width when sidebars are docked */}
        <div className="flex-1 flex flex-col overflow-hidden relative min-w-0">
          <WorkerBeesPanel
            workingDir={projectPath}
          />
        </div>

        {/* Right dock — docked (takes space) when pinned, floating overlay when unpinned */}
        {rightOpen && (
          <div className={`${rightTakesSpace ? "relative flex-shrink-0" : "absolute right-0 top-0 bottom-0 z-40 shadow-2xl shadow-black/40"}`}>
            <ADERightDock
              projectPath={projectPath}
              activeWorkspaceId={activeWorkspaceId}
              pinned={rightPinned}
              onTogglePin={() => setRightPinned((p) => !p)}
              onClose={() => setRightOpen(false)}
              onOpenSettings={() => setShowSettings(true)}
              onOpenProject={handleOpenFolder}
            />
          </div>
        )}
      </div>

      {/* Status Bar */}
      <div className="h-6 glass-toolbar border-t border-bee-border/60 flex items-center justify-between px-3 text-[11px] text-bee-textDim">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5 text-bee-gold">
            <GitBranch size={11} />
            {gitStatus?.branch ?? "no repo"}
          </span>
          {gitStatus && gitStatus.changed > 0 && (
            <span className="text-bee-textMuted">{gitStatus.changed} changed</span>
          )}
        </div>
      </div>

      {showSettings && <SettingsPage onClose={() => setShowSettings(false)} />}
    </div>
  );
}
