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
    <div className="h-screen w-screen flex flex-col bg-[#1a1614] text-[#f5f0e6] font-sans select-none">
      {/* Title Bar - Custom draggable navbar */}
      <div
        className="h-10 bg-[#241f1c] flex items-center px-3 border-b border-[#3d2e1f]"
        data-tauri-drag-region
        onDoubleClick={handleTitleBarDoubleClick}
      >
        <div className="flex items-center gap-3 flex-1">
          <div className="w-7 h-7 bg-gradient-to-br from-[#c9a227] to-[#9a7206] rounded flex items-center justify-center text-xs font-bold text-[#0f0d0c] shadow-lg">
            H
          </div>
          <span className="text-sm font-medium text-[#f5f0e6]">Hiveory AI</span>

          {/* Editor/ADE Toggle */}
          <div className="flex items-center gap-1 ml-4">
            <button
              onClick={() => setSidebarMode("editor")}
              className={`px-3 py-1.5 text-xs rounded flex items-center gap-1.5 transition-colors ${
                sidebarMode === "editor"
                  ? "bg-[#3d2e1f] text-[#f5f0e6]"
                  : "text-[#c9b896] hover:bg-[#3d2e1f]/50 hover:text-[#f5f0e6]"
              }`}
            >
              <File size={12} />
              Editor
            </button>
            <button
              onClick={() => setSidebarMode("ade")}
              className={`px-3 py-1.5 text-xs rounded flex items-center gap-1.5 transition-colors ${
                sidebarMode === "ade"
                  ? "bg-[#3d2e1f] text-[#f5f0e6]"
                  : "text-[#c9b896] hover:bg-[#3d2e1f]/50 hover:text-[#f5f0e6]"
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
                  className="menu-button px-3 py-1.5 text-xs text-[#c9b896] hover:bg-[#3d2e1f]/50 rounded transition-colors capitalize"
                >
                  {menu}
                </button>
                {activeMenu === menu && (
                  <div className="dropdown-menu absolute left-0 top-full mt-1 bg-[#241f1c] border border-[#3d2e1f] rounded shadow-lg z-50 min-w-48">
                    {menuItems[menu as keyof typeof menuItems].map(
                      (item, index) =>
                        item.label === "-" ? (
                          <div key={index} className="h-px bg-[#3d2e1f] my-1" />
                        ) : (
                          <button
                            key={item.label}
                            onClick={() => {
                              item.action();
                              setActiveMenu(null);
                            }}
                            className="w-full px-3 py-1.5 text-left text-xs hover:bg-[#3d2e1f] text-[#f5f0e6]"
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
        <div className="flex items-center gap-1 ml-4">
          <button
            onClick={handleMinimize}
            className="p-1.5 rounded hover:bg-[#3d2e1f] text-[#c9b896] hover:text-[#f5f0e6] transition-colors"
            title="Minimize"
          >
            <Minus size={14} />
          </button>
          <button
            onClick={handleMaximize}
            className="p-1.5 rounded hover:bg-[#3d2e1f] text-[#c9b896] hover:text-[#f5f0e6] transition-colors"
            title={isMaximized ? "Restore" : "Maximize"}
          >
            {isMaximized ? <Copy size={14} /> : <Square size={14} />}
          </button>
          <button
            onClick={handleClose}
            className="p-1.5 rounded hover:bg-red-600 text-[#c9b896] hover:text-white transition-colors"
            title="Close"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Activity Bar */}
        <div className="w-12 bg-[#241f1c] flex flex-col items-center py-2 gap-1 border-r border-[#3d2e1f]">
          <button
            onClick={() => {
              if (activeView === "explorer" && !sidebarCollapsed) {
                setSidebarCollapsed(true);
              } else {
                setActiveView("explorer");
                setSidebarCollapsed(false);
              }
            }}
            className={`p-2 rounded hover:bg-[#3d2e1f]/50 transition-colors ${activeView === "explorer" && !sidebarCollapsed ? "text-[#c9a227]" : "text-[#8a7b5c]"}`}
            title="Explorer"
          >
            <File size={20} />
          </button>
          <button
            onClick={() => {
              if (activeView === "search" && !sidebarCollapsed) {
                setSidebarCollapsed(true);
              } else {
                setActiveView("search");
                setSidebarCollapsed(false);
              }
            }}
            className={`p-2 rounded hover:bg-[#3d2e1f]/50 transition-colors ${activeView === "search" && !sidebarCollapsed ? "text-[#c9a227]" : "text-[#8a7b5c]"}`}
            title="Search"
          >
            <Search size={20} />
          </button>
          <button
            onClick={() => {
              if (activeView === "git" && !sidebarCollapsed) {
                setSidebarCollapsed(true);
              } else {
                setActiveView("git");
                setSidebarCollapsed(false);
              }
            }}
            className={`p-2 rounded hover:bg-[#3d2e1f]/50 transition-colors ${activeView === "git" && !sidebarCollapsed ? "text-[#c9a227]" : "text-[#8a7b5c]"}`}
            title="Source Control"
          >
            <GitBranch size={20} />
          </button>
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
            className={`p-2 rounded hover:bg-[#3d2e1f]/50 transition-colors ${activeView === "settings" && !sidebarCollapsed ? "text-[#c9a227]" : "text-[#8a7b5c]"}`}
            title="Settings"
          >
            <Settings size={20} />
          </button>
        </div>

        {/* Sidebar */}
        {!sidebarCollapsed && (
          <>
            <div
              className="bg-[#241f1c] flex flex-col border-r border-[#3d2e1f]"
              style={{ width: `${sidebarWidth}px` }}
            >
              <div className="h-9 flex items-center justify-between px-4 text-xs font-semibold text-[#c9a227] uppercase tracking-wide">
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
                  className="text-[#8a7b5c] hover:text-[#c9b896]"
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
              className="w-1 bg-[#3d2e1f] hover:bg-[#c9a227] cursor-col-resize transition-colors"
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
      <div className="h-6 bg-gradient-to-r from-[#9a7206] to-[#c9a227] flex items-center justify-between px-3 text-xs text-[#0f0d0c]">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1">
            <GitBranch size={12} />
            main
          </span>
          <span>0 errors, 0 warnings</span>
        </div>
        <div className="flex items-center gap-4">
          <span>Ln 1, Col 1</span>
          <span>UTF-8</span>
          <span>TypeScript</span>
          <span>Spaces: 2</span>
        </div>
      </div>
    </div>
  );
}
