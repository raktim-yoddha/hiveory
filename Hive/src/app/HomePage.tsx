"use client";

import { useState, useEffect, useRef } from "react";
import WorkerBeesPanel from "@/components/workerbees/WorkerBeesPanel";
import CLIPicker, { CLIType, CLI_COMMANDS } from "@/components/workerbees/CLIPicker";
import SettingsPage from "@/components/settings/SettingsPage";
import { useWorkerBeesStore, WorkerBee } from "@/stores/workerBeesStore";
import { getTauriAPIs, loadTauriAPIs } from "@/lib/tauri";
import ADEWorktreeSidebar from "@/components/ade/ADEWorktreeSidebar";
import ADERightDock from "@/components/ade/ADERightDock";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useProjectStore } from "@/stores/projectStore";
import { useUiStore } from "@/stores/uiStore";
import {
  Settings,
  X,
  Minus,
  Square,
  Copy,
  Plus,
  Terminal as TerminalIcon,
  ChevronDown,
  LayoutGrid,
  FolderOpen,
  GitBranch,
  PanelLeft,
  PanelRight,
  Columns3,
} from "lucide-react";

const LAYOUT_OPTIONS: { value: "auto" | 1 | 2 | 3 | 4; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: 1, label: "1" },
  { value: 2, label: "2" },
  { value: 3, label: "3" },
  { value: 4, label: "4" },
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
  const [pickerPosition, setPickerPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const cliPickerContainerRef = useRef<HTMLDivElement>(null);

  // Detected shells for the Terminal launcher dropdown.
  const [detectedShells, setDetectedShells] = useState<{ id: string; label: string; command: string }[]>([]);
  const [showTermMenu, setShowTermMenu] = useState(false);
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

    const handlePickerOutside = (e: MouseEvent) => {
      if (
        cliPickerContainerRef.current &&
        !cliPickerContainerRef.current.contains(e.target as Node)
      ) {
        setShowCLIPicker(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("mousedown", handlePickerOutside);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("mousedown", handlePickerOutside);
    };
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

  const handleAddButtonClick = () => {
    if (showCLIPicker) {
      setShowCLIPicker(false);
    } else {
      if (addButtonRef.current) {
        const rect = addButtonRef.current.getBoundingClientRect();
        setPickerPosition({ x: rect.left, y: rect.bottom + 4 });
      }
      setShowCLIPicker(true);
    }
  };

  const handleCLISelect = (cli: CLIType) => {
    const cliNames: Record<CLIType, string> = {
      "claude-code": "Claude Code",
      "codex-cli": "Codex CLI",
      aider: "Aider",
      "antigravity-cli": "Antigravity CLI",
      opencode: "OpenCode",
      "kimi-code": "Kimi Code",
      cline: "Cline",
      cursor: "Cursor CLI",
      kiro: "Kiro CLI",
      kilo: "Kilo CLI",
    };

    const newWorkerBee: WorkerBee = {
      id: `workerbee-${Date.now()}`,
      cli: CLI_COMMANDS[cli],
      cliName: cliNames[cli],
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

  // Pinned sidebars take flex space (docked); unpinned float over the content.
  const leftTakesSpace = leftPinned && leftOpen;
  const rightTakesSpace = rightPinned && rightOpen;

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

          <div className="flex items-center p-0.5 rounded-lg glass border-bee-border/70">
            {LAYOUT_OPTIONS.map((opt) => (
              <button
                key={opt.label}
                onClick={() => setGridLayout(opt.value)}
                title={opt.value === "auto" ? "Auto layout" : `${opt.value} column${opt.value === 1 ? "" : "s"}`}
                className={`px-1.5 py-1 text-[10px] rounded-md flex items-center gap-1 transition-all ${
                  gridLayout === opt.value
                    ? "bg-bee-gold/15 text-bee-goldHi"
                    : "text-bee-textDim hover:text-bee-text"
                }`}
              >
                {opt.value === "auto" ? <LayoutGrid size={10} /> : opt.label}
              </button>
            ))}
          </div>

          <div ref={cliPickerContainerRef} className="flex-shrink-0">
            <button
              ref={addButtonRef}
              onClick={handleAddButtonClick}
              disabled={false}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] bg-bee-gold/10 border border-bee-gold/20 text-bee-goldHi hover:bg-bee-gold/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="Add new WorkerBee"
            >
              <Plus size={12} />
              <span className="hidden sm:inline">Add</span>
            </button>
            {showCLIPicker && pickerPosition && (
              <CLIPicker
                position={pickerPosition}
                onSelect={handleCLISelect}
                onClose={() => setShowCLIPicker(false)}
              />
            )}
          </div>

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

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
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

        {/* Main grid area */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
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
