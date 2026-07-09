"use client";

import { useState, useEffect, useRef } from "react";
import Sidebar from "@/components/Sidebar";
import EditorPanel from "@/components/editor/EditorPanel";
import ADEPanel from "@/components/terminal/ADEPanel";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
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
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export default function Home() {
  const [sidebarMode, setSidebarMode] = useState<"editor" | "ade">("editor");
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
  const windowRef = useRef<ReturnType<typeof getCurrentWindow> | null>(null);

  useEffect(() => {
    const initializeNectar = async () => {
      try {
        // Always use home directory as default for terminal
        const homeDir = await invoke<string>("get_home_dir");
        setProjectPath(homeDir);

        try {
          const projectPath = await invoke<string>("get_project_path");
          await invoke("ensure_nectar_structure", { projectPath });
        } catch (e) {
          console.error("Failed to initialize Nectar:", e);
        }
        setInitialized(true);
      } catch (e) {
        console.error("Failed to get home directory:", e);
      }
    };

    const initializeWindow = async () => {
      try {
        const window = getCurrentWindow();
        windowRef.current = window;
        // Don't check initial state to avoid permission issues
        // We'll track state locally based on user actions
      } catch (e) {
        console.error("Failed to initialize window:", e);
      }
    };

    initializeNectar();
    initializeWindow();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "`") {
        e.preventDefault();
        setSidebarMode(sidebarMode === "ade" ? "editor" : "ade");
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

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("click", handleClickOutside);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("click", handleClickOutside);
    };
  }, [sidebarMode, sidebarCollapsed]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (isResizing) {
      const newWidth = e.clientX;
      if (newWidth >= 150 && newWidth <= 500) {
        setSidebarWidth(newWidth);
      }
    }
  };

  const handleMouseUp = () => {
    setIsResizing(false);
  };

  const handleMinimize = async () => {
    try {
      const window = getCurrentWindow();
      await window.minimize();
    } catch (e) {
      console.error("Failed to minimize window:", e);
    }
  };

  const handleMaximize = async () => {
    try {
      const window = getCurrentWindow();
      if (isMaximized) {
        await window.unmaximize();
        setIsMaximized(false);
      } else {
        await window.maximize();
        setIsMaximized(true);
      }
    } catch (e) {
      console.error("Failed to toggle maximize:", e);
    }
  };

  const handleClose = async () => {
    try {
      const window = getCurrentWindow();
      await window.close();
    } catch (e) {
      console.error("Failed to close window:", e);
    }
  };

  const handleTitleBarDoubleClick = async () => {
    await handleMaximize();
  };

  const handleFolderSelect = (folderPath: string) => {
    setProjectPath(folderPath);
  };

  const handleNewFile = async () => {
    try {
      const filePath = await save({
        title: "New File",
        defaultPath: projectPath || undefined,
      });
      if (filePath) {
        await invoke("write_file", { path: filePath, content: "" });
        setOpenFile(filePath);
      }
    } catch (e) {
      console.error("Failed to create new file:", e);
    }
  };

  const handleOpenFile = async () => {
    try {
      const filePath = await open({
        multiple: false,
        title: "Open File",
      });
      if (filePath && typeof filePath === "string") {
        setOpenFile(filePath);
      }
    } catch (e) {
      console.error("Failed to open file:", e);
    }
  };

  const handleOpenFolder = async () => {
    try {
      const folderPath = await open({
        directory: true,
        multiple: false,
        title: "Open Folder",
      });
      if (folderPath && typeof folderPath === "string") {
        setProjectPath(folderPath);
        setActiveView("explorer");
        setSidebarCollapsed(false);
      }
    } catch (e) {
      console.error("Failed to open folder:", e);
    }
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
      {
        label: "Expand Selection",
        action: () => console.log("Expand selection"),
      },
      {
        label: "Shrink Selection",
        action: () => console.log("Shrink selection"),
      },
      { label: "-", action: () => {} },
      { label: "Copy Line Up", action: () => console.log("Copy line up") },
      { label: "Copy Line Down", action: () => console.log("Copy line down") },
      { label: "Move Line Up", action: () => console.log("Move line up") },
      { label: "Move Line Down", action: () => console.log("Move line down") },
    ],
    view: [
      {
        label: "Command Palette",
        action: () => console.log("Command palette"),
      },
      { label: "-", action: () => {} },
      { label: "Explorer", action: () => setActiveView("explorer") },
      { label: "Search", action: () => setActiveView("search") },
      { label: "Source Control", action: () => setActiveView("git") },
      { label: "Extensions", action: () => setActiveView("settings") },
      { label: "-", action: () => {} },
      {
        label: "Toggle Sidebar",
        action: () => setSidebarCollapsed(!sidebarCollapsed),
      },
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
      {
        label: "Go to Definition",
        action: () => console.log("Go to definition"),
      },
      {
        label: "Peek Definition",
        action: () => console.log("Peek definition"),
      },
    ],
    run: [
      { label: "Run Task", action: () => console.log("Run task") },
      { label: "-", action: () => {} },
      {
        label: "Start Debugging",
        action: () => console.log("Start debugging"),
      },
      { label: "Run and Debug", action: () => console.log("Run and debug") },
      { label: "-", action: () => {} },
      { label: "Stop Debugging", action: () => console.log("Stop debugging") },
      {
        label: "Restart Debugging",
        action: () => console.log("Restart debugging"),
      },
    ],
    terminal: [
      { label: "New WorkerBee", action: () => setSidebarMode("ade") },
      { label: "-", action: () => {} },
      { label: "Clear terminal", action: () => console.log("Clear terminal") },
      { label: "-", action: () => {} },
      {
        label: "Configure Default Shell",
        action: () => console.log("Configure shell"),
      },
    ],
    help: [
      { label: "Welcome", action: () => console.log("Welcome") },
      { label: "Documentation", action: () => console.log("Documentation") },
      { label: "-", action: () => {} },
      {
        label: "Keyboard Shortcuts",
        action: () => console.log("Keyboard shortcuts"),
      },
      { label: "-", action: () => {} },
      {
        label: "Check for Updates",
        action: () => console.log("Check updates"),
      },
      { label: "About", action: () => console.log("About") },
    ],
  };

  return (
    <div className="h-screen w-screen flex flex-col text-bee-text font-sans select-none">
      {/* Title Bar - Custom draggable navbar */}
      <div
        className="h-11 glass-toolbar flex items-center px-3 border-b border-bee-border/60"
        data-tauri-drag-region
        onDoubleClick={handleTitleBarDoubleClick}
      >
        <div className="flex items-center gap-3 flex-1">
          <div className="w-7 h-7 bg-gradient-to-br from-bee-goldHi to-bee-goldDim rounded-lg flex items-center justify-center text-xs font-bold text-[#1a1200] shadow-glow">
            H
          </div>
          <span className="text-sm font-semibold tracking-tight text-bee-text">
            Hiveory<span className="text-bee-gold">AI</span>
          </span>

          {/* Editor/ADE Toggle — segmented glass control */}
          <div className="flex items-center p-0.5 ml-4 rounded-lg glass border-bee-border/70">
            <button
              onClick={() => setSidebarMode("editor")}
              className={`px-3 py-1 text-xs rounded-md flex items-center gap-1.5 transition-all ${
                sidebarMode === "editor"
                  ? "bg-bee-gold/15 text-bee-goldHi shadow-glow"
                  : "text-bee-textDim hover:text-bee-text"
              }`}
            >
              <File size={12} />
              Editor
            </button>
            <button
              onClick={() => setSidebarMode("ade")}
              className={`px-3 py-1 text-xs rounded-md flex items-center gap-1.5 transition-all ${
                sidebarMode === "ade"
                  ? "bg-bee-gold/15 text-bee-goldHi shadow-glow"
                  : "text-bee-textDim hover:text-bee-text"
              }`}
            >
              <Terminal size={12} />
              ADE
            </button>
          </div>

          {/* Menu Items */}
          <div className="flex items-center gap-1 ml-4">
            {Object.keys(menuItems).map((menu) => (
              <div key={menu} className="relative">
                <button
                  onClick={() =>
                    setActiveMenu(activeMenu === menu ? null : menu)
                  }
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
                    {menuItems[menu as keyof typeof menuItems].map(
                      (item, index) =>
                        item.label === "-" ? (
                          <div key={index} className="h-px bg-bee-border/60 my-1 mx-1" />
                        ) : (
                          <button
                            key={item.label}
                            onClick={() => {
                              item.action();
                              setActiveMenu(null);
                            }}
                            className="w-full px-3 py-1.5 text-left text-xs rounded-lg hover:bg-bee-gold/15 hover:text-bee-goldHi text-bee-textDim transition-colors"
                          >
                            {item.label}
                          </button>
                        ),
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Window Controls */}
        <div className="flex items-center gap-0.5 ml-4">
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
        {/* Activity Bar */}
        <div className="w-12 glass-rail flex flex-col items-center py-2 gap-1 border-r border-bee-border/60">
          {(
            [
              { view: "explorer", icon: File, title: "Explorer" },
              { view: "search", icon: Search, title: "Search" },
              { view: "git", icon: GitBranch, title: "Source Control" },
            ] as const
          ).map(({ view, icon: Icon, title }) => {
            const active = activeView === view && !sidebarCollapsed;
            return (
              <button
                key={view}
                onClick={() => {
                  if (active) {
                    setSidebarCollapsed(true);
                  } else {
                    setActiveView(view);
                    setSidebarCollapsed(false);
                  }
                }}
                className={`relative p-2 rounded-lg transition-colors ${
                  active
                    ? "text-bee-goldHi bg-bee-gold/10"
                    : "text-bee-textMuted hover:text-bee-textDim hover:bg-bee-border/40"
                }`}
                title={title}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-full bg-bee-gold" />
                )}
                <Icon size={20} />
              </button>
            );
          })}
          <div className="flex-1" />
          <button
            onClick={() => {
              if (activeView === "settings" && !sidebarCollapsed) {
                setSidebarCollapsed(true);
              } else {
                setActiveView("settings");
                setSidebarCollapsed(false);
              }
            }}
            className={`p-2 rounded-lg transition-colors ${activeView === "settings" && !sidebarCollapsed ? "text-bee-goldHi bg-bee-gold/10" : "text-bee-textMuted hover:text-bee-textDim hover:bg-bee-border/40"}`}
            title="Settings"
          >
            <Settings size={20} />
          </button>
        </div>

        {/* Sidebar */}
        {!sidebarCollapsed && (
          <>
            <div
              className="glass flex flex-col border-y-0 border-l-0 border-r border-bee-border/60"
              style={{ width: `${sidebarWidth}px` }}
            >
              <div className="h-9 flex items-center justify-between px-4 text-[11px] font-semibold text-bee-gold uppercase tracking-[0.14em]">
                <span>
                  {activeView === "explorer"
                    ? "Explorer"
                    : activeView === "search"
                      ? "Search"
                      : activeView === "git"
                        ? "Source Control"
                        : "Settings"}
                </span>
                <button
                  onClick={() => setSidebarCollapsed(true)}
                  className="text-bee-textMuted hover:text-bee-textDim transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
              <Sidebar
                mode={sidebarMode}
                onModeChange={setSidebarMode}
                onFileSelect={setOpenFile}
                onFolderSelect={handleFolderSelect}
              />
            </div>
            <div
              className="w-px bg-bee-border/60 hover:bg-bee-gold cursor-col-resize transition-colors"
              onMouseDown={handleMouseDown}
            />
          </>
        )}

        {/* Main Panel */}
        <div className="flex-1 flex overflow-hidden min-w-0">
          {sidebarMode === "editor" ? (
            <EditorPanel openFile={openFile} projectPath={projectPath} />
          ) : (
            <ADEPanel layout={1} workingDir={projectPath} />
          )}
        </div>
      </div>

      {/* Status Bar */}
      <div className="h-6 glass-toolbar border-t border-bee-border/60 flex items-center justify-between px-3 text-[11px] text-bee-textDim">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5 text-bee-gold">
            <GitBranch size={11} />
            main
          </span>
          <span className="text-bee-textMuted">0 errors, 0 warnings</span>
        </div>
        <div className="flex items-center gap-4 text-bee-textMuted">
          <span>Ln 1, Col 1</span>
          <span>UTF-8</span>
          <span>TypeScript</span>
          <span>Spaces: 2</span>
        </div>
      </div>
    </div>
  );
}
