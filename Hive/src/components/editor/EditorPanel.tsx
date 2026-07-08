"use client";

import { useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import { X, Search, Settings, GitBranch, FileCode, Save } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import EditorTerminalPanel from "./EditorTerminalPanel";

interface EditorPanelProps {
  openFile: string | null;
  projectPath?: string | null;
}

interface OpenTab {
  id: string;
  name: string;
  path: string;
  language: string;
  modified: boolean;
  content: string;
}

export default function EditorPanel({
  openFile,
  projectPath,
}: EditorPanelProps) {
  const editorRef = useRef<any>(null);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [cursorPosition, setCursorPosition] = useState({ line: 1, column: 1 });
  const [language, setLanguage] = useState("typescript");
  const [loading, setLoading] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(256);
  const [isResizingTerminal, setIsResizingTerminal] = useState(false);

  const getFileIcon = (filename: string) => {
    const ext = filename.split(".").pop()?.toLowerCase();
    const icons: Record<string, string> = {
      ts: "📘",
      tsx: "⚛️",
      js: "📜",
      jsx: "⚛️",
      json: "📋",
      md: "📝",
      css: "🎨",
      html: "🌐",
      rs: "🦀",
      toml: "⚙️",
      gitignore: "🚫",
    };
    return icons[ext || ""] || "📄";
  };

  const getLanguageFromPath = (path: string): string => {
    const ext = path.split(".").pop()?.toLowerCase();
    const languages: Record<string, string> = {
      ts: "typescript",
      tsx: "typescript",
      js: "javascript",
      jsx: "javascript",
      json: "json",
      md: "markdown",
      css: "css",
      html: "html",
      rs: "rust",
      toml: "toml",
    };
    return languages[ext || ""] || "plaintext";
  };

  useEffect(() => {
    const loadFile = async () => {
      if (openFile && !tabs.find((t) => t.path === openFile)) {
        setLoading(true);
        try {
          const content = await invoke<string>("read_file", { path: openFile });
          const newTab: OpenTab = {
            id: Date.now().toString(),
            name: openFile.split("/").pop() || openFile,
            path: openFile,
            language: getLanguageFromPath(openFile),
            modified: false,
            content,
          };
          setTabs([...tabs, newTab]);
          setActiveTab(newTab.id);
          setLanguage(newTab.language);
        } catch (e) {
          console.error("Failed to load file:", e);
        } finally {
          setLoading(false);
        }
      }
    };
    loadFile();
  }, [openFile]);

  const closeTab = (tabId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setTabs(tabs.filter((t) => t.id !== tabId));
    if (activeTab === tabId) {
      setActiveTab(tabs.length > 1 ? tabs[tabs.length - 2].id : null);
    }
  };

  const saveFile = async () => {
    if (!activeTab) return;
    const tab = tabs.find((t) => t.id === activeTab);
    if (!tab) return;

    try {
      await invoke("write_file", { path: tab.path, content: tab.content });
      setTabs(
        tabs.map((t) => (t.id === activeTab ? { ...t, modified: false } : t)),
      );
    } catch (e) {
      console.error("Failed to save file:", e);
    }
  };

  const handleEditorChange = (value: string | undefined) => {
    if (!activeTab) return;
    setTabs(
      tabs.map((t) =>
        t.id === activeTab ? { ...t, content: value || "", modified: true } : t,
      ),
    );
  };

  const handleTerminalMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingTerminal(true);

    const startY = e.clientY;
    const startHeight = terminalHeight;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = startY - moveEvent.clientY;
      const newHeight = Math.max(
        100,
        Math.min(window.innerHeight - 200, startHeight + deltaY),
      );
      setTerminalHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsResizingTerminal(false);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  return (
    <div className="flex-1 flex flex-col bg-[#1e1e1e]">
      {/* File tabs */}
      <div className="h-9 bg-[#252526] flex items-center overflow-x-auto">
        {tabs.length === 0 ? (
          <div className="px-4 text-sm text-gray-500 italic">No files open</div>
        ) : (
          tabs.map((tab) => (
            <div
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`h-full flex items-center px-3 gap-2 cursor-pointer border-r border-[#1e1e1e] min-w-max transition-colors ${
                activeTab === tab.id
                  ? "bg-[#1e1e1e] text-white"
                  : "bg-[#2d2d2d] text-gray-400 hover:bg-[#323232]"
              }`}
            >
              <span className="text-sm">{getFileIcon(tab.name)}</span>
              <span className="text-sm font-medium">{tab.name}</span>
              {tab.modified && (
                <span className="w-2 h-2 rounded-full bg-yellow-500" />
              )}
              <button
                onClick={(e) => closeTab(tab.id, e)}
                className="p-1 rounded hover:bg-[#3c3c3c] opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X size={14} />
              </button>
            </div>
          ))
        )}
      </div>

      {/* Editor + terminal container */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Editor */}
        <div className="flex-1 relative min-h-0">
          {loading ? (
            <div className="flex items-center justify-center h-full text-gray-500">
              Loading...
            </div>
          ) : (
            <Editor
              height="100%"
              defaultLanguage={language}
              theme="vs-dark"
              value={
                activeTab
                  ? tabs.find((t) => t.id === activeTab)?.content
                  : "// Select a file to edit"
              }
              onChange={handleEditorChange}
              onMount={(editor, monaco) => {
                editorRef.current = editor;
                editor.onDidChangeCursorPosition((e: any) => {
                  setCursorPosition({
                    line: e.position.lineNumber,
                    column: e.position.column,
                  });
                });
              }}
              options={{
                minimap: { enabled: true },
                fontSize: 14,
                fontFamily: "JetBrains Mono, Consolas, Monaco, monospace",
                lineNumbers: "on",
                scrollBeyondLastLine: false,
                renderWhitespace: "selection",
                automaticLayout: true,
                tabSize: 2,
                wordWrap: "off",
                formatOnPaste: true,
                formatOnType: true,
                suggest: {
                  showKeywords: true,
                  showSnippets: true,
                },
                padding: { top: 10 },
              }}
            />
          )}
        </div>

        {/* Resize handle */}
        <div
          className="h-1 bg-[#241f1c] hover:bg-[#c9a227] cursor-ns-resize transition-colors flex-shrink-0"
          onMouseDown={handleTerminalMouseDown}
        />

        {/* Terminal Panel */}
        <EditorTerminalPanel workingDir={projectPath} height={terminalHeight} />
      </div>
    </div>
  );
}
