"use client";

import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm, ITerminalOptions } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { SearchAddon } from "xterm-addon-search";
import {
  Terminal,
  ChevronDown,
  Copy,
  Trash2,
  Eraser,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

interface TerminalPaneProps {
  paneId?: string;
  workingDir?: string | null;
  tabName?: string;
  workerBee?: {
    id: string;
    cli: string;
    cliName: string;
    customName?: string;
  };
  onClose?: () => void;
  onToggleMaximize?: () => void;
  isMaximized?: boolean;
  onRename?: () => void;
  isEditing?: boolean;
  editValue?: string;
  onEditChange?: (value: string) => void;
  onCancelRename?: () => void;
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
  workerBee,
  onClose,
  onToggleMaximize,
  isMaximized,
  onRename,
  isEditing,
  editValue,
  onEditChange,
  onCancelRename,
}: TerminalPaneProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstance = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [, setIsSpawned] = useState(false);
  const [selectedTerminal, setSelectedTerminal] = useState<TerminalType>("powershell");
  const [showTerminalMenu, setShowTerminalMenu] = useState(false);

  const isWorkerBee = !!workerBee;
  const displayName = isWorkerBee
    ? workerBee.customName || workerBee.cliName
    : tabName || paneId;

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
    let onDataDisposable: { dispose: () => void } | null = null;
    let handleResize: (() => void) | null = null;

    const initTerminal = async () => {
      try {
        const { Terminal } = await import("xterm");
        const { FitAddon } = await import("xterm-addon-fit");
        const { SearchAddon } = await import("xterm-addon-search");

        const options: ITerminalOptions = {
          cursorBlink: true,
          cursorStyle: "block",
          fontSize: 14,
          fontFamily: 'Cascadia Code, Consolas, "Courier New", monospace',
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

        terminal = new Terminal(options);
        const fitAddon = new FitAddon();
        const searchAddon = new SearchAddon();

        terminal.loadAddon(fitAddon);
        terminal.loadAddon(searchAddon);
        fitAddonRef.current = fitAddon;

        terminal.open(terminalRef.current!);
        fitAddon.fit();
        terminalInstance.current = terminal;

        // Pipe user keystrokes into the process's stdin.
        onDataDisposable = terminal.onData((data) => {
          writeToProcess(data);
        });

        // Keep the terminal fitted to its container on window resize.
        handleResize = () => {
          if (disposed || !terminal) return;
          fitAddon.fit();
          const { rows, cols } = terminal;
          invoke("resize_terminal", { paneId, rows, cols }).catch(
            console.error,
          );
        };
        window.addEventListener("resize", handleResize);

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

        // Spawn terminal
        try {
          const command = isWorkerBee
            ? workerBee.cli
            : TERMINAL_COMMANDS[selectedTerminal];

          await invoke("spawn_terminal", {
            paneId,
            command,
            args: [],
            workingDir: spawnDir,
          });

          if (disposed || !terminal) return;
          setIsSpawned(true);

          // Sync the pty size with the fitted terminal.
          const { rows, cols } = terminal;
          invoke("resize_terminal", { paneId, rows, cols }).catch(
            console.error,
          );

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
      } catch (e) {
        console.error("Failed to initialize terminal:", e);
      }
    };

    initTerminal();

    return () => {
      disposed = true;
      if (handleResize) window.removeEventListener("resize", handleResize);
      onDataDisposable?.dispose();
      terminal?.dispose();
      terminalInstance.current = null;
      setIsSpawned(false);
    };
  }, [
    paneId,
    isWorkerBee ? workerBee.cli : selectedTerminal,
    workingDir,
    isWorkerBee,
  ]);

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

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".dropdown-menu")) {
        setShowTerminalMenu(false);
      }
    };

    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  return (
    <div className="flex flex-col h-full bg-[#1a1614]/85 overflow-hidden">
      {/* terminal header */}
      <div className="h-8 glass-toolbar border-b border-bee-border/50 flex items-center justify-between px-2">
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
              className="bg-bee-canvas text-bee-text px-2 py-0.5 rounded-md text-xs w-32 focus:outline-none focus:ring-1 focus:ring-bee-gold border border-bee-border"
              autoFocus
            />
          ) : (
            <span
              onDoubleClick={onRename}
              className="flex items-center gap-1.5 text-xs text-bee-text font-medium cursor-pointer hover:text-bee-gold transition-colors"
            >
              {isWorkerBee && (
                <span className="w-1.5 h-1.5 rounded-full bg-bee-gold shadow-glow" />
              )}
              {displayName}
            </span>
          )}

          {!isWorkerBee && (
            /* terminal selector - only for terminal */
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowTerminalMenu(!showTerminalMenu);
                }}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md bg-bee-canvas/70 border border-bee-border hover:border-bee-gold/60 text-bee-textDim hover:text-bee-text transition-all"
              >
                <Terminal size={11} className="text-bee-gold" />
                {TERMINAL_LABELS[selectedTerminal]}
                <ChevronDown size={10} className="text-bee-textMuted" />
              </button>
              {showTerminalMenu && (
                <div className="dropdown-menu absolute left-0 top-8 glass-hi rounded-xl z-20 min-w-40 p-1 animate-fade-in">
                  <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-bee-gold font-semibold">
                    Terminal Type
                  </div>
                  {(Object.keys(TERMINAL_LABELS) as TerminalType[]).map(
                    (terminal) => (
                      <button
                        key={terminal}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedTerminal(terminal);
                          setShowTerminalMenu(false);
                          setIsSpawned(false);
                        }}
                        className={`w-full px-2.5 py-1.5 text-left text-xs rounded-lg flex items-center gap-2 transition-colors ${selectedTerminal === terminal ? "bg-bee-gold/15 text-bee-goldHi" : "text-bee-textDim hover:bg-bee-border/50 hover:text-bee-text"}`}
                      >
                        <Terminal
                          size={11}
                          className={
                            selectedTerminal === terminal
                              ? "text-bee-gold"
                              : "text-bee-textMuted"
                          }
                        />
                        {TERMINAL_LABELS[terminal]}
                      </button>
                    ),
                  )}
                </div>
              )}
            </div>
          )}
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
              title="Delete WorkerBee"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>

      {/* terminal content */}
      <div
        className="flex-1 overflow-hidden relative min-h-0"
        style={{ contain: "layout paint" }}
      >
        <div
          ref={terminalRef}
          className="absolute inset-0 overflow-hidden"
        />
      </div>
    </div>
  );
}
