"use client";

import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm, ITerminalOptions } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { SearchAddon } from "xterm-addon-search";
import { WebglAddon } from "xterm-addon-webgl";
import {
  Terminal,
  Copy,
  Trash2,
  Eraser,
  Maximize2,
  Minimize2,
  X,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useWorkerBeesStore } from "@/features/worker-bees/workerBeesStore";

// Plain shell terminal only — cmd / PowerShell / Git Bash / WSL. CLI agents
// (Claude Code, Codex CLI, Aider, Gemini CLI, ...) are a separate, standalone
// feature; see components/workerbees/WorkerBeePane.tsx for that.
interface TerminalPaneProps {
  paneId?: string;
  workingDir?: string | null;
  tabName?: string;
  /** Shell chosen at launch (e.g. "pwsh.exe"). Overrides the in-pane picker until the user switches. */
  shellCommand?: string;
  shellLabel?: string;
  onClose?: () => void;
  onToggleMaximize?: () => void;
  isMaximized?: boolean;
  onRename?: () => void;
  isEditing?: boolean;
  editValue?: string;
  onEditChange?: (value: string) => void;
  onCancelRename?: () => void;
  closeIconType?: "trash" | "close";
}

type TerminalType = "cmd" | "powershell" | "git-bash" | "wsl";

const TERMINAL_LABELS: Record<TerminalType, string> = {
  cmd: "CMD",
  powershell: "PowerShell",
  "git-bash": "Git Bash",
  wsl: "WSL",
};

const TERMINAL_COMMANDS: Record<TerminalType, string> = {
  cmd: "cmd.exe",
  powershell: "powershell.exe",
  "git-bash": "bash.exe",
  wsl: "wsl.exe",
};

export default function TerminalPane({
  paneId = "terminal-1",
  workingDir,
  tabName,
  shellCommand,
  shellLabel,
  onClose,
  onToggleMaximize,
  isMaximized,
  onRename,
  isEditing,
  editValue,
  onEditChange,
  onCancelRename,
  closeIconType = "trash",
}: TerminalPaneProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstance = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [, setIsSpawned] = useState(false);
  const [selectedTerminal, setSelectedTerminal] = useState<TerminalType>("powershell");
  // The shell chosen at launch. Cleared when the user picks from the in-pane
  // menu, so that menu takes over from then on.
  const [launchCommand, setLaunchCommand] = useState<string | undefined>(shellCommand);

  const displayName = tabName || paneId;
  const refitCount = useWorkerBeesStore((s) => s.refitCount);

  // Re-fit xterm whenever a global refit signal fires (tab switch, maximize/
  // minimize). We intentionally read refitCount outside the main init effect
  // so it never causes a terminal respawn.
  useEffect(() => {
    if (!fitAddonRef.current || !terminalRef.current) return;
    const rect = terminalRef.current.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      try { fitAddonRef.current.fit(); } catch {}
    }
  }, [refitCount]);

  // Pipes data into the spawned process's stdin.
  const writeToProcess = (data: string) => {
    invoke("write_to_terminal", { paneId, data }).catch((e) =>
      console.error(`write_to_terminal failed for ${paneId}:`, e),
    );
  };

  useEffect(() => {
    if (!terminalRef.current) return;

    let disposed = false;
    let terminal: XTerm | null = null;
    let webglAddon: WebglAddon | null = null;
    let onDataDisposable: { dispose: () => void } | null = null;
    let handleResize: (() => void) | null = null;
    let observerRef: ResizeObserver | null = null;
    let resizeDebounce: ReturnType<typeof setTimeout> | null = null;
    let spawned = false;

    const hasValidSize = () => {
      if (!terminalRef.current) return false;
      const rect = terminalRef.current.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const spawnProcess = async () => {
      if (spawned || disposed || !terminal) return;
      spawned = true;

      // Get working directory
      let spawnDir = workingDir;
      if (!spawnDir) {
        try {
          spawnDir = await invoke<string>("get_project_path");
        } catch (e) {
          try {
            spawnDir = await invoke<string>("get_home_dir");
          } catch (e2) {
            console.error("Failed to get working directory:", e2);
          }
        }
      }

      // Spawn terminal — the launch-chosen shell wins until the user switches.
      try {
        const command = launchCommand || TERMINAL_COMMANDS[selectedTerminal];
        const { rows, cols } = terminal;

        await invoke("spawn_terminal", {
          paneId,
          command,
          args: [],
          workingDir: spawnDir,
          rows,
          cols,
        });

        if (disposed || !terminal) return;
        setIsSpawned(true);

        // Start reading output. Guard on `disposed` (a stable closure var),
        // not on React state, so the loop actually runs until unmount.
        const readOutput = async () => {
          while (!disposed) {
            try {
              const output = await invoke<string>("read_from_terminal", {
                paneId,
              });
              if (output && !disposed && terminal) {
                terminal.write(output);
              }
            } catch (e) {
              console.error("Read error:", e);
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        };
        readOutput();
      } catch (e) {
        if (!disposed && terminal) {
          terminal.writeln(`\x1b[31mFailed to spawn terminal: ${e}\x1b[0m`);
        }
      }
    };

    const initTerminal = () => {
      try {
        const options: ITerminalOptions = {
          cursorBlink: true,
          cursorStyle: "block",
          fontSize: 14,
          fontFamily: '"Geist Mono", Cascadia Code, Consolas, monospace',
          fontWeight: "400",
          fontWeightBold: "700",
          lineHeight: 1.2,
          theme: {
            background: "#1a1614",
            foreground: "#f5f0e6",
            cursor: "#c9a227",
            cursorAccent: "#0f0d0c",
            selectionBackground: "rgba(201, 162, 39, 0.28)",
            selectionForeground: "#fffbeb",
            black: "#1a1614",
            red: "#ef4444",
            green: "#22c55e",
            yellow: "#c9a227",
            blue: "#3b82f6",
            magenta: "#a855f7",
            cyan: "#06b6d4",
            white: "#f5f0e6",
            brightBlack: "#3d2e1f",
            brightRed: "#f87171",
            brightGreen: "#4ade80",
            brightYellow: "#d4b84a",
            brightBlue: "#60a5fa",
            brightMagenta: "#c084fc",
            brightCyan: "#22d3ee",
            brightWhite: "#fffbeb",
          },
          allowTransparency: false,
          rightClickSelectsWord: true,
          scrollback: 1000,
        };

        terminal = new XTerm(options);
        const fitAddon = new FitAddon();
        const searchAddon = new SearchAddon();

        terminal.loadAddon(fitAddon);
        terminal.loadAddon(searchAddon);
        fitAddonRef.current = fitAddon;

        terminal.open(terminalRef.current!);
        terminalInstance.current = terminal;

        // Try to load WebGL addon for better performance, fall back gracefully
        try {
          webglAddon = new WebglAddon();
          terminal.loadAddon(webglAddon);
        } catch (e) {
          console.warn('[TerminalPane] WebGL addon not available, using canvas renderer:', e);
        }

        const fit = () => {
          if (disposed || !terminal) return false;
          try {
            fitAddon.fit();
            return true;
          } catch (e) {
            console.warn("[TerminalPane] fit() failed:", e);
            return false;
          }
        };

        const syncSize = () => {
          if (disposed || !terminal) return;
          const { rows, cols } = terminal;
          invoke("resize_terminal", { paneId, rows, cols }).catch(console.error);
        };

        const fitAndSync = () => {
          if (resizeDebounce) clearTimeout(resizeDebounce);
          resizeDebounce = setTimeout(() => {
            if (disposed || !terminal) return;
            if (hasValidSize()) {
              if (fit()) {
                if (!spawned) {
                  spawnProcess();
                } else {
                  syncSize();
                }
              }
            }
          }, 150);
        };

        // Pipe user keystrokes into the process's stdin.
        onDataDisposable = terminal.onData((data) => {
          writeToProcess(data);
        });

        // Keep the terminal fitted to its container on window resize
        handleResize = fitAndSync;
        window.addEventListener("resize", handleResize);

        const resizeObserver = new ResizeObserver(() => fitAndSync());
        resizeObserver.observe(terminalRef.current!);
        observerRef = resizeObserver;

        // Trigger once to capture initial state if already laid out
        fitAndSync();
      } catch (e) {
        console.error("Failed to initialize terminal:", e);
      }
    };

    initTerminal();

    return () => {
      disposed = true;
      if (resizeDebounce) clearTimeout(resizeDebounce);
      if (handleResize) window.removeEventListener("resize", handleResize);
      observerRef?.disconnect();
      onDataDisposable?.dispose();

      // Dispose WebGL addon first, wrapped in try/catch
      // This is a known issue with xterm-addon-webgl: dispose() can throw
      // if the WebGL context was lost or never fully initialized
      try {
        if (webglAddon) {
          webglAddon.dispose();
          webglAddon = null;
        }
      } catch (e) {
        console.warn('[TerminalPane] Failed to dispose WebGL addon:', e);
      }

      // Then dispose the terminal
      try {
        if (terminal) {
          terminal.dispose();
        }
      } catch (e) {
        console.warn('[TerminalPane] Failed to dispose terminal:', e);
      } finally {
        // Always clear the ref even if disposal throws
        terminalInstance.current = null;
        setIsSpawned(false);
      }
    };
  }, [paneId, selectedTerminal, launchCommand, workingDir]);

  const handleCopy = () => {
    if (terminalInstance.current) {
      const selection = terminalInstance.current.getSelection();
      if (selection) {
        navigator.clipboard.writeText(selection);
      }
    }
  };

  const handleClear = () => {
    if (terminalInstance.current) {
      terminalInstance.current.clear();
    }
  };


  return (
    <div className="flex flex-col h-full bg-[#1a1614]/85 overflow-hidden">
      {/* terminal header — blade (steel) theme, distinct from the gold agents */}
      <div
        data-pane-drag
        className="h-8 border-b flex items-center justify-between px-2 cursor-grab active:cursor-grabbing backdrop-blur-md"
        style={{ borderColor: "rgba(159,178,201,0.34)", background: "linear-gradient(90deg, rgba(159,178,201,0.18), rgba(159,178,201,0.05))" }}
      >
        <div className="flex items-center gap-2">
          {isEditing && onEditChange ? (
            <input
              type="text"
              value={editValue}
              onChange={(e) => onEditChange(e.target.value)}
              onBlur={onRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onRename?.();
                if (e.key === 'Escape') onCancelRename?.();
              }}
              onClick={(e) => e.stopPropagation()}
              className="bg-bee-canvas text-bee-text px-2 py-0.5 rounded-md text-xs w-32 focus:outline-none focus:ring-1 focus:ring-[#9fb2c9] border border-bee-border"
              autoFocus
            />
          ) : (
            <span
              onDoubleClick={onRename}
              className="text-xs text-bee-text font-medium cursor-pointer hover:text-[#9fb2c9] transition-colors"
            >
              {displayName}
            </span>
          )}

          {/* No separate shell-label chip — the tab name already identifies the
              terminal. Showing both duplicated the name (and reappeared on
              rename). */}
        </div>
        <div className="flex items-center gap-1">
          {onToggleMaximize && (
            <button
              onClick={onToggleMaximize}
              className="p-1.5 rounded-md hover:bg-bee-border/60 text-bee-textDim hover:text-bee-text transition-colors"
              title={isMaximized ? "Restore" : "Maximize"}
            >
              {isMaximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            </button>
          )}
          <button
            onClick={handleCopy}
            className="p-1.5 rounded-md hover:bg-bee-border/60 text-bee-textDim hover:text-bee-text transition-colors"
            title="Copy selection"
          >
            <Copy size={12} />
          </button>
          <button
            onClick={handleClear}
            className="p-1.5 rounded-md hover:bg-bee-border/60 text-bee-textDim hover:text-bee-text transition-colors"
            title="Clear terminal"
          >
            <Eraser size={12} />
          </button>
          {onClose && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              className="p-1.5 rounded-md text-bee-textDim hover:bg-bee-err/25 hover:text-bee-err transition-colors"
              title={closeIconType === "close" ? "Collapse terminal" : "Close terminal"}
            >
              {closeIconType === "close" ? <X size={12} /> : <Trash2 size={12} />}
            </button>
          )}
        </div>
      </div>

      {/* terminal content */}
      <div
        className="flex-1 overflow-hidden relative min-h-0 p-2"
        style={{ contain: "layout paint" }}
      >
        <div ref={terminalRef} className="absolute inset-2 overflow-hidden" />
      </div>
    </div>
  );
}
