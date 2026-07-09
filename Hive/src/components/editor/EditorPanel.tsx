"use client";

import { useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import {
  X,
  File,
  FileCode,
  FileText,
  FileCog,
  Braces,
  Hash,
  type LucideIcon,
} from "lucide-react";
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

  const getFileIcon = (filename: string): { Icon: LucideIcon; className: string } => {
    const ext = filename.split(".").pop()?.toLowerCase();
    const map: Record<string, { Icon: LucideIcon; className: string }> = {
      ts: { Icon: FileCode, className: "text-bee-gold" },
      tsx: { Icon: FileCode, className: "text-bee-goldHi" },
      js: { Icon: FileCode, className: "text-bee-honey" },
      jsx: { Icon: FileCode, className: "text-bee-goldHi" },
      rs: { Icon: FileCode, className: "text-bee-err" },
      json: { Icon: Braces, className: "text-bee-amber" },
      md: { Icon: FileText, className: "text-bee-textDim" },
      css: { Icon: Hash, className: "text-bee-gold" },
      html: { Icon: FileCode, className: "text-bee-warn" },
      toml: { Icon: FileCog, className: "text-bee-textMuted" },
      yaml: { Icon: FileCog, className: "text-bee-textMuted" },
      yml: { Icon: FileCog, className: "text-bee-textMuted" },
    };
    return map[ext || ""] || { Icon: File, className: "text-bee-textMuted" };
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
    <div className="flex-1 flex flex-col bg-bee-canvas/40">
      {/* File tabs */}
      <div className="h-9 glass-toolbar border-b border-bee-border/60 flex items-center overflow-x-auto">
        {tabs.length === 0 ? (
          <div className="px-4 text-[13px] text-bee-textMuted italic">
            No files open
          </div>
        ) : (
          tabs.map((tab) => {
            const { Icon, className } = getFileIcon(tab.name);
            const active = activeTab === tab.id;
            return (
              <div
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`group relative h-full flex items-center px-3 gap-2 cursor-pointer min-w-max transition-colors ${
                  active
                    ? "bg-bee-surface/60 text-bee-text"
                    : "text-bee-textMuted hover:text-bee-textDim hover:bg-bee-border/30"
                }`}
              >
                {active && (
                  <span className="absolute top-0 left-0 right-0 h-0.5 bg-bee-gold" />
                )}
                <Icon size={14} className={className} />
                <span className="text-[13px] font-medium">{tab.name}</span>
                {tab.modified && (
                  <span className="w-1.5 h-1.5 rounded-full bg-bee-gold" />
                )}
                <button
                  onClick={(e) => closeTab(tab.id, e)}
                  className="p-0.5 rounded hover:bg-bee-border/70 text-bee-textMuted hover:text-bee-text opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X size={13} />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Editor + terminal container */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Editor */}
        <div className="flex-1 relative min-h-0">
          {loading ? (
            <div className="flex items-center justify-center h-full text-bee-textMuted">
              Loading…
            </div>
          ) : (
            <Editor
              height="100%"
              defaultLanguage={language}
              theme="hiveory-dark"
              value={
                activeTab
                  ? tabs.find((t) => t.id === activeTab)?.content
                  : "// Select a file to edit"
              }
              onChange={handleEditorChange}
              beforeMount={(monaco) => {
                monaco.editor.defineTheme("hiveory-dark", {
                  base: "vs-dark",
                  inherit: true,
                  rules: [
                    { token: "comment", foreground: "8a7b5c", fontStyle: "italic" },
                    { token: "keyword", foreground: "d4b84a" },
                    { token: "string", foreground: "c9b896" },
                    { token: "number", foreground: "e8c547" },
                    { token: "type", foreground: "d0a43f" },
                    { token: "function", foreground: "d4b84a" },
                    { token: "variable", foreground: "f5f0e6" },
                  ],
                  colors: {
                    "editor.background": "#1a1614",
                    "editor.foreground": "#f5f0e6",
                    "editorLineNumber.foreground": "#5c4f3a",
                    "editorLineNumber.activeForeground": "#c9a227",
                    "editorCursor.foreground": "#c9a227",
                    "editor.selectionBackground": "#3d2e1f",
                    "editor.lineHighlightBackground": "#241f1c80",
                    "editorIndentGuide.background1": "#2b2420",
                    "editorIndentGuide.activeBackground1": "#3d2e1f",
                    "editorGutter.background": "#1a1614",
                    "editorWidget.background": "#241f1c",
                    "editorWidget.border": "#3d2e1f",
                    "editorSuggestWidget.background": "#241f1c",
                    "editorSuggestWidget.selectedBackground": "#3d2e1f",
                    "minimap.background": "#17130f",
                    "scrollbarSlider.background": "#9a720655",
                    "scrollbarSlider.hoverBackground": "#c9a22755",
                  },
                });
              }}
              onMount={(editor, monaco) => {
                editorRef.current = editor;
                monaco.editor.setTheme("hiveory-dark");
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
                fontFamily:
                  'var(--font-mono), "JetBrains Mono", "Cascadia Code", Consolas, monospace',
                fontLigatures: true,
                lineNumbers: "on",
                scrollBeyondLastLine: false,
                renderWhitespace: "selection",
                automaticLayout: true,
                tabSize: 2,
                wordWrap: "off",
                formatOnPaste: true,
                formatOnType: true,
                smoothScrolling: true,
                cursorSmoothCaretAnimation: "on",
                roundedSelection: true,
                suggest: {
                  showKeywords: true,
                  showSnippets: true,
                },
                padding: { top: 12 },
              }}
            />
          )}
        </div>

        {/* Resize handle */}
        <div
          className="h-1 bg-bee-border/60 hover:bg-bee-gold cursor-ns-resize transition-colors flex-shrink-0"
          onMouseDown={handleTerminalMouseDown}
        />

        {/* Terminal Panel */}
        <EditorTerminalPanel workingDir={projectPath} height={terminalHeight} />
      </div>
    </div>
  );
}
