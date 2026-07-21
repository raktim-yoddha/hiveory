"use client";

import { useState, useEffect, useRef } from "react";
import PlaneHost, { PlaneSwitcher } from "@/features/panes/PlaneHost";
import KanbanPanel from "@/features/task-comb/TaskCombPanel";
import VoiceHotkeys from "@/features/voice/VoiceHotkeys";
import HiveoryLogo from "@/shared/HiveoryLogo";
import SettingsPage from "@/features/settings/SettingsPage";
import ExtensionsMarketplace from "@/features/extensions/ExtensionsMarketplace";
import { Blocks } from "lucide-react";
import { useWorkerBeesStore, WorkerBee } from "@/features/worker-bees/workerBeesStore";
import { getTauriAPIs, loadTauriAPIs } from "@/shared/tauri";
import ADEWorktreeSidebar from "@/features/workspaces/WorkspacesSidebar";
import ADERightDock from "@/features/dock/RightDock";
import { useWorkspaceStore } from "@/features/workspaces/workspaceStore";
import { useProjectStore } from "@/shared/projectStore";
import { useUiStore } from "@/shared/uiStore";
import {
  Settings,
  X,
  Minus,
  Square,
  Copy,
  FolderOpen,
  GitBranch,
  PanelLeft,
  PanelRight,
  Columns3,
} from "lucide-react";


export default function HomePage() {
  const [initialized, setInitialized] = useState(false);
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showExtensions, setShowExtensions] = useState(false);
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
  const agentStatuses = useWorkerBeesStore((state) => state.agentStatuses);
  const refitTerminals = useWorkerBeesStore((state) => state.refitTerminals);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const updateWorkspace = useWorkspaceStore((s) => s.updateWorkspace);
  const boardOpen = useWorkspaceStore((s) => s.boardOpen);
  const setBoardOpen = useWorkspaceStore((s) => s.setBoardOpen);
  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);

  useEffect(() => {
    const id = requestAnimationFrame(() => refitTerminals());
    return () => cancelAnimationFrame(id);
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

  // Pane adds live in each plane's own header now (see PlaneHost).


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
            <HiveoryLogo size={24} />
            <span className="text-xs font-semibold tracking-tight text-bee-text hidden sm:inline">
              Hive<span className="text-bee-gold">ory</span>
            </span>
          </div>

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

          {/* Plane layout is chosen by dragging a pane to the top snap picker
              (see PlaneHost) — no title-bar dropdown needed. */}

          {/* Plane switcher — one center surface at a time (WorkerBees /
              Terminal / Browser / CoWorkers / Emulator). Adds moved into each
              plane's own header. */}
          <PlaneSwitcher />
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

          <button
            onClick={() => setShowExtensions(true)}
            className="p-1.5 rounded-md hover:bg-bee-border/60 text-bee-textMuted hover:text-bee-text transition-colors"
            title="Browse extensions (Open-VSX)"
          >
            <Blocks size={14} />
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
              projectPath={projectPath}
              pinned={leftPinned}
              onTogglePin={() => setLeftPinned((p) => !p)}
              onClose={() => setLeftOpen(false)}
            />
          </div>
        )}

        {/* Main grid area — min-w-0 allows flex to shrink below children's intrinsic width when sidebars are docked */}
        <div className="flex-1 flex flex-col overflow-hidden relative min-w-0">
          <PlaneHost workingDir={projectPath} />
          {/* Task Comb is docked to the center, outside the plane, so switching
              planes never moves it. A fullscreen plane covers it — the plane's
              floating Task Comb widget takes over there. */}
          <KanbanPanel
            open={boardOpen}
            tasks={activeWorkspace?.taskCards ?? []}
            statuses={agentStatuses}
            projectPath={projectPath}
            activeWorkspaceId={activeWorkspaceId}
            onClose={() => setBoardOpen(false)}
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
      {showExtensions && <ExtensionsMarketplace onClose={() => setShowExtensions(false)} />}

      {/* Global voice hotkeys: Ctrl+Win (type anywhere) · Ctrl+Alt (WorkerBee). */}
      <VoiceHotkeys />
    </div>
  );
}
