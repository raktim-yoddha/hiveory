"use client";

import { useState, useEffect, useRef } from "react";
import Sidebar from "@/components/Sidebar";
import EditorPanel from "@/components/editor/EditorPanel";
import WorkerBeesPanel from "@/components/workerbees/WorkerBeesPanel";
import CLIPicker, { CLIType, CLI_COMMANDS } from "@/components/workerbees/CLIPicker";
import SettingsPage from "@/components/settings/SettingsPage";
import { useWorkerBeesStore, WorkerBee } from "@/stores/workerBeesStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { getTauriAPIs, loadTauriAPIs } from "@/lib/tauri";
import WorkspacesPanel from "@/components/workspace/WorkspacesPanel";
import AgentDock from "@/components/queenbee/AgentDock";
import ADEWorktreeSidebar from "@/components/ade/ADEWorktreeSidebar";
import ADESessionHistory from "@/components/ade/ADESessionHistory";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import {
  File,
  Terminal,
  Settings,
  Search,
  GitBranch,
  X,
  Minus,
  Square,
  Copy,
  Plus,
  LayoutGrid,
  Check,
  FolderOpen,
  Bot,
  ScrollText,
} from "lucide-react";

const LAYOUT_OPTIONS: { value: "auto" | 1 | 2 | 3 | 4; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: 1, label: "1" },
  { value: 2, label: "2" },
  { value: 3, label: "3" },
  { value: 4, label: "4" },
];

export default function HomePage() {
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [activeView, setActiveView] = useState<
    "explorer" | "search" | "git" | "settings"
  >("explorer");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(250);
  const [isResizing, setIsResizing] = useState(false);
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [gitStatus, setGitStatus] = useState<{
    branch: string;
    changed: number;
  } | null>(null);
  const windowRef = useRef<any>(null);

  const autosaveEnabled = useSettingsStore((s) => s.autosaveEnabled);
  const setAutosaveEnabled = useSettingsStore((s) => s.setAutosaveEnabled);

  const workerBees = useWorkerBeesStore((state) => state.workerBees);
  const addWorkerBee = useWorkerBeesStore((state) => state.addWorkerBee);
  const setAgentStatus = useWorkerBeesStore((state) => state.setAgentStatus);
  const gridLayout = useWorkerBeesStore((state) => state.gridLayout);
  const setGridLayout = useWorkerBeesStore((state) => state.setGridLayout);
  const refitTerminals = useWorkerBeesStore((state) => state.refitTerminals);
  const mode = useWorkspaceStore((s) => s.mode);
  const setMode = useWorkspaceStore((s) => s.setMode);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const updateWorkspace = useWorkspaceStore((s) => s.updateWorkspace);
  const boardOpen = useWorkspaceStore((s) => s.boardOpen);
  const setBoardOpen = useWorkspaceStore((s) => s.setBoardOpen);

  const [showWorkspaces, setShowWorkspaces] = useState(false);
  const [showAgentDock, setShowAgentDock] = useState(true);
  const [showSessionHistory, setShowSessionHistory] = useState(false);
  const [workspacesDocked, setWorkspacesDocked] = useState(false);
  const [queenbeeDocked, setQueenbeeDocked] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => refitTerminals());
    return () => cancelAnimationFrame(id);
  }, [mode]);

  const [showCLIPicker, setShowCLIPicker] = useState(false);
  const [pickerPosition, setPickerPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const cliPickerContainerRef = useRef<HTMLDivElement>(null);

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
      if (e.ctrlKey && e.key === "`") {
        e.preventDefault();
        const modes: Array<'editor' | 'ade'> = ['editor', 'ade'];
        const idx = modes.indexOf(mode);
        setMode(modes[(idx + 1) % modes.length]);
      }
      if (e.ctrlKey && e.key === "b") {
        e.preventDefault();
        setSidebarCollapsed(!sidebarCollapsed);
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        !target.closest(".dropdown-menu") &&
        !target.closest(".menu-button")
      ) {
        setActiveMenu(null);
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
    window.addEventListener("click", handleClickOutside);
    window.addEventListener("mousedown", handlePickerOutside);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("click", handleClickOutside);
      window.removeEventListener("mousedown", handlePickerOutside);
    };
  }, [mode, sidebarCollapsed]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (isResizing) {
      const newWidth = e.clientX - 48;
      if (newWidth >= 150 && newWidth <= 500) {
        setSidebarWidth(newWidth);
      }
    }
  };

  const handleMouseUp = () => {
    setIsResizing(false);
  };

  useEffect(() => {
    if (isResizing) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    } else {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    }
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing]);

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
    try {
      const apis = getTauriAPIs();
      if (apis?.invoke) {
        await apis.invoke("ensure_nectar_structure", { projectPath: folderPath });
      }
    } catch (e) {
      console.error("Failed to initialize Nectar for folder:", e);
    }
  };

  const handleNewFile = async () => {
    try {
      const apis = getTauriAPIs();
      if (!apis?.save || !apis?.invoke) return;
      const filePath = await apis.save({ title: "New File", defaultPath: projectPath || undefined });
      if (filePath) {
        await apis.invoke("write_file", { path: filePath, content: "" });
        setOpenFile(filePath);
      }
    } catch (e) {
      console.error("Failed to create new file:", e);
    }
  };

  const handleOpenFile = async () => {
    try {
      const apis = getTauriAPIs();
      if (!apis?.open) return;
      const filePath = await apis.open({ multiple: false, title: "Open File" });
      if (filePath && typeof filePath === "string") setOpenFile(filePath);
    } catch (e) {
      console.error("Failed to open file:", e);
    }
  };

  const handleOpenFolder = async () => {
    try {
      const apis = getTauriAPIs();
      if (!apis?.open) return;
      const folderPath = await apis.open({ directory: true, multiple: false, title: "Open Folder" });
      if (folderPath && typeof folderPath === "string") {
        await handleFolderSelect(folderPath);
        setActiveView("explorer");
        setSidebarCollapsed(false);
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

    // Sync to active workspace
    if (activeWorkspaceId) {
      const ws = workspaces.find((w) => w.id === activeWorkspaceId);
      if (ws) {
        updateWorkspace(activeWorkspaceId, {
          paneLayout: [...ws.paneLayout, newWorkerBee],
        });
      }
    }
  };

  const menuItems = {
    file: [
      { label: "New File", action: handleNewFile },
      { label: "New Window", action: () => console.log("New window") },
      { label: "Open File...", action: handleOpenFile },
      { label: "Open Folder...", action: handleOpenFolder },
      { label: "-", action: () => {} },
      { label: "Save", action: () => console.log("Save") },
      { label: "Save As...", action: () => console.log("Save as") },
      { label: "Save All", action: () => console.log("Save all") },
      { label: "-", action: () => {} },
      { label: "Autosave", action: () => setAutosaveEnabled(!autosaveEnabled), checked: autosaveEnabled },
      { label: "-", action: () => {} },
      { label: "Exit", action: handleClose },
    ],
    edit: [
      { label: "Undo", action: () => console.log("Undo") },
      { label: "Redo", action: () => console.log("Redo") },
      { label: "-", action: () => {} },
      { label: "Cut", action: () => console.log("Cut") },
      { label: "Copy", action: () => console.log("Copy") },
      { label: "Paste", action: () => console.log("Paste") },
      { label: "-", action: () => {} },
      { label: "Find", action: () => console.log("Find") },
      { label: "Replace", action: () => console.log("Replace") },
      { label: "-", action: () => {} },
      { label: "Go to Line", action: () => console.log("Go to line") },
    ],
    selection: [
      { label: "Select All", action: () => console.log("Select all") },
      { label: "-", action: () => {} },
      { label: "Expand Selection", action: () => console.log("Expand selection") },
      { label: "Shrink Selection", action: () => console.log("Shrink selection") },
      { label: "-", action: () => {} },
      { label: "Copy Line Up", action: () => console.log("Copy line up") },
      { label: "Copy Line Down", action: () => console.log("Copy line down") },
      { label: "Move Line Up", action: () => console.log("Move line up") },
      { label: "Move Line Down", action: () => console.log("Move line down") },
    ],
    view: [
      { label: "Command Palette", action: () => console.log("Command palette") },
      { label: "-", action: () => {} },
      { label: "Explorer", action: () => setActiveView("explorer") },
      { label: "Search", action: () => setActiveView("search") },
      { label: "Source Control", action: () => setActiveView("git") },
      { label: "Extensions", action: () => setActiveView("settings") },
      { label: "-", action: () => {} },
      { label: "Toggle Sidebar", action: () => setSidebarCollapsed(!sidebarCollapsed) },
      { label: "-", action: () => {} },
      { label: "Appearance", action: () => console.log("Appearance") },
    ],
    go: [
      { label: "Go to File...", action: () => console.log("Go to file") },
      { label: "Go to Line...", action: () => console.log("Go to line") },
      { label: "Go to Symbol...", action: () => console.log("Go to symbol") },
      { label: "-", action: () => {} },
      { label: "Back", action: () => console.log("Back") },
      { label: "Forward", action: () => console.log("Forward") },
      { label: "-", action: () => {} },
      { label: "Go to Definition", action: () => console.log("Go to definition") },
      { label: "Peek Definition", action: () => console.log("Peek definition") },
    ],
    run: [
      { label: "Run Task", action: () => console.log("Run task") },
      { label: "-", action: () => {} },
      { label: "Start Debugging", action: () => console.log("Start debugging") },
      { label: "Run and Debug", action: () => console.log("Run and debug") },
      { label: "-", action: () => {} },
      { label: "Stop Debugging", action: () => console.log("Stop debugging") },
      { label: "Restart Debugging", action: () => console.log("Restart debugging") },
    ],
    terminal: [
      { label: "Clear terminal", action: () => console.log("Clear terminal") },
      { label: "-", action: () => {} },
      { label: "Configure Default Shell", action: () => console.log("Configure shell") },
    ],
    help: [
      { label: "Welcome", action: () => console.log("Welcome") },
      { label: "Documentation", action: () => console.log("Documentation") },
      { label: "-", action: () => {} },
      { label: "Keyboard Shortcuts", action: () => console.log("Keyboard shortcuts") },
      { label: "-", action: () => {} },
      { label: "Check for Updates", action: () => console.log("Check updates") },
      { label: "About", action: () => console.log("About") },
    ],
  };

  return (
    <div className="h-screen w-screen flex flex-col text-bee-text font-sans select-none">
      {/* Title Bar */}
      <div
        className="relative z-50 h-11 glass-toolbar flex items-center px-3 border-b border-bee-border/60"
        data-tauri-drag-region
        onDoubleClick={handleTitleBarDoubleClick}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-7 h-7 bg-gradient-to-br from-bee-goldHi to-bee-goldDim rounded-lg flex items-center justify-center text-xs font-bold text-[#1a1200] shadow-glow">
            H
          </div>
          <span className="text-sm font-semibold tracking-tight text-bee-text">
            Hiveory<span className="text-bee-gold">AI</span>
          </span>

          {/* Editor/ADE Toggle */}
          <div className="flex items-center p-0.5 ml-4 rounded-lg glass border-bee-border/70">
            <button
              onClick={() => setMode("editor")}
              className={`px-3 py-1 text-xs rounded-md flex items-center transition-all ${
                mode === "editor"
                  ? "bg-bee-gold/15 text-bee-goldHi shadow-glow"
                  : "text-bee-textDim hover:text-bee-text"
              }`}
            >
              <File size={12} />
              Editor
            </button>
            <button
              onClick={() => setMode("ade")}
              className={`px-3 py-1 text-xs rounded-md flex items-center transition-all ${
                mode === "ade"
                  ? "bg-bee-gold/15 text-bee-goldHi shadow-glow"
                  : "text-bee-textDim hover:text-bee-text"
              }`}
            >
              <Terminal size={12} />
              ADE
            </button>
          </div>

          {mode === "editor" ? (
            <div className="flex items-center gap-1 ml-4">
              {Object.keys(menuItems).map((menu) => (
                <div key={menu} className="relative">
                  <button
                    onClick={() => setActiveMenu(activeMenu === menu ? null : menu)}
                    className={`menu-button px-2.5 py-1 text-xs rounded-md transition-colors capitalize ${
                      activeMenu === menu
                        ? "bg-bee-gold/10 text-bee-text"
                        : "text-bee-textDim hover:text-bee-text hover:bg-bee-border/40"
                    }`}
                  >
                    {menu}
                  </button>
                  {activeMenu === menu && (
                    <div className="dropdown-menu absolute left-0 top-full mt-1.5 glass-hi rounded-xl z-50 min-w-52 p-1 animate-fade-in">
                      {menuItems[menu as keyof typeof menuItems].map((item, index) =>
                        item.label === "-" ? (
                          <div key={index} className="h-px bg-bee-border/60 my-1 mx-1" />
                        ) : (
                          <button
                            key={item.label}
                            onClick={() => { item.action(); setActiveMenu(null); }}
                            className="w-full px-3 py-1.5 text-left text-xs rounded-lg hover:bg-bee-gold/15 hover:text-bee-goldHi text-bee-textDim transition-colors flex items-center gap-2"
                          >
                            <span className="w-3 flex-shrink-0">
                              {"checked" in item && item.checked && (
                                <Check size={12} className="text-bee-gold" />
                              )}
                            </span>
                            {item.label}
                          </button>
                        ),
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-3 ml-4 min-w-0">
              <span className="text-xs font-semibold tracking-wide text-bee-text">
                WorkerBees
              </span>
              <span className="text-[11px] font-medium text-bee-gold bg-bee-gold/10 border border-bee-gold/20 px-2 py-0.5 rounded-full flex-shrink-0">
                {workerBees.length}/16
              </span>

              <button
                onClick={handleOpenFolder}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs glass border-bee-border/70 text-bee-textDim hover:text-bee-text transition-colors min-w-0 flex-shrink"
                title={projectPath || "Open a project folder"}
              >
                <FolderOpen size={12} className="text-bee-gold flex-shrink-0" />
                <span className="truncate max-w-[140px]">
                  {projectPath ? projectPath.split(/[\\/]/).filter(Boolean).pop() : "Open Project"}
                </span>
              </button>

              <div className="flex items-center p-0.5 rounded-lg glass border-bee-border/70">
                {LAYOUT_OPTIONS.map((opt) => (
                  <button
                    key={opt.label}
                    onClick={() => setGridLayout(opt.value)}
                    title={opt.value === "auto" ? "Auto layout" : `${opt.value} column${opt.value === 1 ? "" : "s"}`}
                    className={`px-2 py-1 text-[11px] rounded-md flex items-center gap-1 transition-all ${
                      gridLayout === opt.value
                        ? "bg-bee-gold/15 text-bee-goldHi"
                        : "text-bee-textDim hover:text-bee-text"
                    }`}
                  >
                    {opt.value === "auto" ? <LayoutGrid size={11} /> : opt.label}
                  </button>
                ))}
              </div>

              <div ref={cliPickerContainerRef} className="flex-shrink-0">
                <button
                  ref={addButtonRef}
                  onClick={handleAddButtonClick}
                  disabled={workerBees.length >= 16}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs bg-bee-gold/10 border border-bee-gold/20 text-bee-goldHi hover:bg-bee-gold/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Add new WorkerBee"
                >
                  <Plus size={13} />
                  Add
                </button>
                {showCLIPicker && pickerPosition && (
                  <CLIPicker
                    position={pickerPosition}
                    onSelect={handleCLISelect}
                    onClose={() => setShowCLIPicker(false)}
                  />
                )}
              </div>
            </div>
          )}
        </div>

        {/* Window Controls */}
        <div className="flex items-center gap-0.5 ml-4">
          <button
            onClick={() => setShowSettings(true)}
            className="p-1.5 rounded-md hover:bg-bee-border/60 text-bee-textDim hover:text-bee-text transition-colors"
            title="CLI Agent API Keys"
          >
            <Settings size={14} />
          </button>
          <button
            onClick={handleMinimize}
            className="p-1.5 rounded-md hover:bg-bee-border/60 text-bee-textDim hover:text-bee-text transition-colors"
            title="Minimize"
          >
            <Minus size={14} />
          </button>
          <button
            onClick={handleMaximize}
            className="p-1.5 rounded-md hover:bg-bee-border/60 text-bee-textDim hover:text-bee-text transition-colors"
            title={isMaximized ? "Restore" : "Maximize"}
          >
            {isMaximized ? <Copy size={14} /> : <Square size={14} />}
          </button>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-md hover:bg-bee-err/80 text-bee-textDim hover:text-white transition-colors"
            title="Close"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {mode === "editor" && (
          <>
            <div className="w-12 glass-rail flex flex-col items-center py-2 gap-1 border-r border-bee-border/60">
              {([{ view: "explorer", icon: File, title: "Explorer" },
                { view: "search", icon: Search, title: "Search" },
                { view: "git", icon: GitBranch, title: "Source Control" },
              ] as const).map(({ view, icon: Icon, title }) => {
                const active = activeView === view && !sidebarCollapsed;
                return (
                  <button
                    key={view}
                    onClick={() => { if (active) setSidebarCollapsed(true); else { setActiveView(view); setSidebarCollapsed(false); } }}
                    className={`relative p-2 rounded-lg transition-colors ${active ? "text-bee-goldHi bg-bee-gold/10" : "text-bee-textMuted hover:text-bee-textDim hover:bg-bee-border/40"}`}
                    title={title}
                  >
                    {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-full bg-bee-gold" />}
                    <Icon size={20} />
                  </button>
                );
              })}
              <div className="flex-1" />
              <button
                onClick={() => { if (activeView === "settings" && !sidebarCollapsed) setSidebarCollapsed(true); else { setActiveView("settings"); setSidebarCollapsed(false); } }}
                className={`p-2 rounded-lg transition-colors ${activeView === "settings" && !sidebarCollapsed ? "text-bee-goldHi bg-bee-gold/10" : "text-bee-textMuted hover:text-bee-textDim hover:bg-bee-border/40"}`}
                title="Settings"
              >
                <Settings size={20} />
              </button>
            </div>

            {!sidebarCollapsed && (
              <>
                <div className="glass flex flex-col border-y-0 border-l-0 border-r border-bee-border/60 flex-shrink-0" style={{ width: `${sidebarWidth}px` }}>
                  <div className="h-9 flex items-center justify-between px-4 text-[11px] font-semibold text-bee-gold uppercase tracking-[0.14em]">
                    <span>{activeView === "explorer" ? "Explorer" : activeView === "search" ? "Search" : activeView === "git" ? "Source Control" : "Settings"}</span>
                    <button onClick={() => setSidebarCollapsed(true)} className="text-bee-textMuted hover:text-bee-textDim transition-colors"><X size={14} /></button>
                  </div>
                  <Sidebar mode={mode} onModeChange={setMode} onFileSelect={setOpenFile} onFolderSelect={handleFolderSelect} rootPath={projectPath} />
                </div>
                <div className="w-1.5 -mx-0.5 z-10 cursor-col-resize group flex-shrink-0" onMouseDown={handleMouseDown}>
                  <div className="w-px h-full mx-auto bg-bee-border/60 group-hover:bg-bee-gold transition-colors" />
                </div>
              </>
            )}
          </>
        )}

        <div className={`flex-1 flex overflow-hidden min-w-0 ${mode !== "editor" ? "hidden" : ""}`}>
          <EditorPanel openFile={openFile} projectPath={projectPath} />
        </div>
        <div className={`flex-1 flex overflow-hidden min-w-0 relative ${mode !== "ade" ? "hidden" : ""}`}>
          {/* Left sidebar — Workspace/Worktree list (always visible, resizable) */}
          <div className="relative h-full flex-shrink-0">
            <ADEWorktreeSidebar />
          </div>

          {/* Main grid area */}
          <div className="flex-1 flex flex-col overflow-hidden relative">
            <WorkerBeesPanel
              workingDir={projectPath}
              onToggleWorkspaces={() => setShowWorkspaces(!showWorkspaces)}
              onToggleBoard={() => setBoardOpen(!boardOpen)}
              onToggleAgentDock={() => setShowAgentDock(!showAgentDock)}
              onToggleSessionHistory={() => setShowSessionHistory(!showSessionHistory)}
              workspacesDocked={workspacesDocked}
              queenbeeDocked={queenbeeDocked}
              sessionHistoryOpen={showSessionHistory}
            />
          </div>

          {/* Right panel — toggle between AgentDock and SessionHistory */}
          {showAgentDock && !showSessionHistory && (
            <div className={queenbeeDocked ? "" : "absolute right-0 top-0 bottom-0 z-40"}>
              <AgentDock
                docked={queenbeeDocked}
                onToggleDock={() => setQueenbeeDocked(!queenbeeDocked)}
              />
            </div>
          )}
          {showSessionHistory && (
            <div className="h-full flex-shrink-0">
              <ADESessionHistory
                projectPath={projectPath}
                activeWorktreeId={activeWorkspaceId}
                activeWorkspaceId={activeWorkspaceId}
              />
            </div>
          )}
        </div>
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
        <div className="flex items-center gap-4 text-bee-textMuted">
          <span>Ln 1, Col 1</span>
          <span>UTF-8</span>
          <span>TypeScript</span>
          <span>Spaces: 2</span>
        </div>
      </div>

      {showSettings && <SettingsPage onClose={() => setShowSettings(false)} />}
    </div>
  );
}
