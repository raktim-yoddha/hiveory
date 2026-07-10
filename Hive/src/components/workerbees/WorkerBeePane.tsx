"use client";

import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm, ITerminalOptions } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { SearchAddon } from "xterm-addon-search";
import { WebglAddon } from "xterm-addon-webgl";
import {
  Copy,
  Trash2,
  Eraser,
  Maximize2,
  Minimize2,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore, envForCli } from "@/stores/settingsStore";
import { Nectar, type InjectedChunk } from "@/lib/nectar";

// A WorkerBee pane is a CLI agent process (Claude Code, Codex CLI, Aider,
// Gemini CLI, OpenCode, Kimi Code, Cline, ...) — a fundamentally different
// thing from a plain shell terminal (see components/terminal/TerminalPane).
// It's wired to inject Nectar project memory and pass provider API keys, and
// it has no concept of "which shell" — it's always exactly one CLI command.
export interface WorkerBeeInfo {
  id: string;
  cli: string;
  cliName: string;
  customName?: string;
  args?: string[];
}

interface WorkerBeePaneProps {
  paneId: string;
  workingDir?: string | null;
  workerBee: WorkerBeeInfo;
  onClose?: () => void;
  onToggleMaximize?: () => void;
  isMaximized?: boolean;
  onRename?: () => void;
  isEditing?: boolean;
  editValue?: string;
  onEditChange?: (value: string) => void;
  onCancelRename?: () => void;
}

// How long to wait with zero output before hinting that the CLI might not be
// installed, rather than leaving the user staring at an ambiguous spinner.
const STALL_HINT_MS = 8000;

// A freshly-scaffolded memory file is just its placeholder HTML comment —
// FTS5 will happily "match" that noise against broad keywords. AGENTS.md
// §4.2.4: "if nothing clears a minimum relevance threshold, inject nothing."
function isMeaningfulChunk(content: string): boolean {
  return content.replace(/<!--[\s\S]*?-->/g, "").trim().length > 0;
}

// No per-turn task prompt exists yet at launch time, so the bootstrap query
// is keyword-rich enough to surface whatever general project context exists
// (overview, conventions, past decisions, known bugs) via FTS5 keyword match.
const BOOTSTRAP_QUERY =
  "project overview architecture conventions decisions patterns bugs knowledge";

export default function WorkerBeePane({
  paneId,
  workingDir,
  workerBee,
  onClose,
  onToggleMaximize,
  isMaximized,
  onRename,
  isEditing,
  editValue,
  onEditChange,
  onCancelRename,
}: WorkerBeePaneProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstance = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [spawnState, setSpawnState] = useState<"connecting" | "running" | "error">("connecting");
  const [stalled, setStalled] = useState(false);
  const apiKeys = useSettingsStore((s) => s.apiKeys);
  const nectarTokenBudget = useSettingsStore((s) => s.nectarTokenBudget);

  const [paneWidth, setPaneWidth] = useState(0);
  const [paneHeight, setPaneHeight] = useState(0);

  const getFontSize = () => {
    if (paneWidth < 280) return 9;
    if (paneWidth < 380) return 11;
    if (paneWidth < 500) return 12;
    return 14;
  };

  const fontSize = getFontSize();

  useEffect(() => {
    if (terminalInstance.current) {
      terminalInstance.current.options.fontSize = fontSize;
      if (fitAddonRef.current) {
        try {
          fitAddonRef.current.fit();
          const { rows, cols } = terminalInstance.current;
          invoke("resize_terminal", { paneId, rows, cols }).catch(console.error);
        } catch (e) {
          console.warn("Failed to refit terminal after font size change:", e);
        }
      }
    }
  }, [fontSize, paneId]);

  const displayName = workerBee.customName || workerBee.cliName;

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
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    let resizeDebounce: ReturnType<typeof setTimeout> | null = null;
    setSpawnState("connecting");
    setStalled(false);

    let spawned = false;

    const hasValidSize = () => {
      if (!terminalRef.current) return false;
      const rect = terminalRef.current.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const spawnProcess = async () => {
      if (spawned || disposed || !terminal) return;
      spawned = true;

      let spawnDir = workingDir;
      if (!spawnDir) {
        try {
          spawnDir = await invoke<string>("get_project_path");
        } catch {
          try {
            spawnDir = await invoke<string>("get_home_dir");
          } catch (e2) {
            console.error("Failed to get working directory:", e2);
          }
        }
      }

      try {
        const command = workerBee.cli;
        const args = workerBee.args || [];
        const env = envForCli(command, apiKeys);
        const { rows, cols } = terminal;

        await invoke("spawn_terminal", {
          paneId,
          command,
          args,
          workingDir: spawnDir,
          env,
          rows,
          cols,
        });

        if (disposed || !terminal) return;

        stallTimer = setTimeout(() => {
          if (!disposed) setStalled(true);
        }, STALL_HINT_MS);

        const readOutput = async () => {
          while (!disposed) {
            try {
              const output = await invoke<string>("read_from_terminal", { paneId });
              if (output && !disposed && terminal) {
                terminal.write(output);
                setSpawnState("running");
                setStalled(false);
                if (stallTimer) {
                  clearTimeout(stallTimer);
                  stallTimer = null;
                }

                // Debug print the active xterm.js buffer lines
                console.log(`[xterm buffer debug - ${paneId}]`);
                for (let i = 0; i < Math.min(25, terminal.buffer.active.length); i++) {
                  const line = terminal.buffer.active.getLine(i);
                  if (line) {
                    const lineText = line.translateToString(true).trim();
                    if (lineText) {
                      console.log(`  Line ${i}: "${lineText}"`);
                    }
                  }
                }
              }
            } catch (e) {
              console.error("Read error:", e);
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        };
        readOutput();

        // WorkerBees are forced through Nectar retrieval per AGENTS.md
        // §4.2: read project memory (via the real FTS5-backed index, not a
        // hand-rolled file concatenation), inject it as the agent's first
        // turn, and log what was retrieved for audit. Runs in the
        // background so it never delays the terminal becoming usable.
        if (spawnDir) {
          (async () => {
            try {
              const nectar = await Nectar.create(spawnDir!);
              const { files } = await nectar.listMemoryFiles();
              for (const file of files) {
                await nectar.indexFile(file);
              }

              const injectResp = await nectar.inject(BOOTSTRAP_QUERY, [], undefined, {
                max_tokens: nectarTokenBudget,
                max_chunks: 20,
                min_score: 0,
              });
              const meaningful: InjectedChunk[] = injectResp.chunks.filter((c) =>
                isMeaningfulChunk(c.content),
              );
              if (meaningful.length === 0 || disposed || !terminal) return;

              const { formatted_text } = await nectar.formatContext(
                workerBee.cli,
                meaningful,
              );
              if (!formatted_text || disposed || !terminal) return;

              // Give the CLI a moment to boot its input prompt before
              // typing into its stdin.
              await new Promise((resolve) => setTimeout(resolve, 1200));
              if (disposed || !terminal) return;

              terminal.writeln(
                `\x1b[38;5;178m[nectar] injecting ${meaningful.length} chunk(s) from project memory\x1b[0m`,
              );
              writeToProcess(formatted_text + "\r");

              await nectar.logSession(
                paneId,
                workerBee.cli,
                BOOTSTRAP_QUERY,
                injectResp.query,
                meaningful,
                injectResp.total_tokens,
              );
            } catch (e) {
              console.error("Nectar injection failed:", e);
            }
          })();
        }
      } catch (e) {
        if (!disposed && terminal) {
          terminal.writeln(`\x1b[31mFailed to spawn ${displayName}: ${e}\x1b[0m`);
        }
        if (!disposed) setSpawnState("error");
      }
    };

    const initTerminal = () => {
      try {
        const options: ITerminalOptions = {
          cursorBlink: true,
          cursorStyle: "block",
          fontSize: getFontSize(),
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
          scrollback: 2000,
        };

        terminal = new XTerm(options);
        const fitAddon = new FitAddon();
        const searchAddon = new SearchAddon();

        terminal.loadAddon(fitAddon);
        terminal.loadAddon(searchAddon);
        fitAddonRef.current = fitAddon;

        // Custom keyboard intercept to ensure Ctrl+C sends SIGINT to process, not kills pane
        terminal.attachCustomKeyEventHandler((arg) => {
          if (arg.ctrlKey && arg.code === "KeyC") {
            if (terminal?.hasSelection()) {
              return false; // let xterm handle copying
            }
            if (arg.type === "keydown") {
              writeToProcess("\x03");
            }
            return false;
          }
          return true;
        });

        terminal.open(terminalRef.current!);
        terminalInstance.current = terminal;

        try {
          webglAddon = new WebglAddon();
          terminal.loadAddon(webglAddon);
        } catch (e) {
          console.warn("[WorkerBeePane] WebGL addon not available, using canvas renderer:", e);
        }

        const fit = () => {
          if (disposed || !terminal) return false;
          try {
            fitAddon.fit();
            return true;
          } catch (e) {
            console.warn("[WorkerBeePane] fit() failed:", e);
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

        onDataDisposable = terminal.onData((data) => {
          writeToProcess(data);
        });

        handleResize = fitAndSync;
        window.addEventListener("resize", handleResize);

        const resizeObserver = new ResizeObserver((entries) => {
          for (const entry of entries) {
            const { width, height } = entry.contentRect;
            setPaneWidth(width);
            setPaneHeight(height);
          }
          fitAndSync();
        });
        resizeObserver.observe(terminalRef.current!);
        observerRef = resizeObserver;

        fitAndSync();
      } catch (e) {
        console.error("Failed to initialize WorkerBee pane:", e);
      }
    };

    initTerminal();

    return () => {
      disposed = true;
      if (stallTimer) clearTimeout(stallTimer);
      if (resizeDebounce) clearTimeout(resizeDebounce);
      if (handleResize) window.removeEventListener("resize", handleResize);
      observerRef?.disconnect();
      onDataDisposable?.dispose();

      try {
        webglAddon?.dispose();
      } catch (e) {
        console.warn("[WorkerBeePane] Failed to dispose WebGL addon:", e);
      }

      try {
        terminal?.dispose();
      } catch (e) {
        console.warn("[WorkerBeePane] Failed to dispose terminal:", e);
      } finally {
        terminalInstance.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId, workerBee.cli, workingDir]);

  const handleCopy = () => {
    const selection = terminalInstance.current?.getSelection();
    if (selection) navigator.clipboard.writeText(selection);
  };

  const handleClear = () => {
    terminalInstance.current?.clear();
  };

  return (
    <div className="flex flex-col h-full bg-[#1a1614]/85 overflow-hidden">
      {/* pane header */}
      <div className="h-8 glass-toolbar border-b border-bee-border/50 flex items-center justify-between px-2">
        <div className="flex items-center gap-2 min-w-0">
          {isEditing && onEditChange ? (
            <input
              type="text"
              value={editValue}
              onChange={(e) => onEditChange(e.target.value)}
              onBlur={onRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") onRename?.();
                if (e.key === "Escape") onCancelRename?.();
              }}
              onClick={(e) => e.stopPropagation()}
              className="bg-bee-canvas text-bee-text px-2 py-0.5 rounded-md text-xs w-32 focus:outline-none focus:ring-1 focus:ring-bee-gold border border-bee-border"
              autoFocus
            />
          ) : (
            <span
              onDoubleClick={onRename}
              className="flex items-center gap-1.5 text-xs text-bee-text font-medium cursor-pointer hover:text-bee-gold transition-colors truncate"
            >
              {paneWidth >= 160 && (
                <span
                  className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    spawnState === "error"
                      ? "bg-bee-err"
                      : spawnState === "connecting"
                        ? "bg-bee-warn animate-pulse"
                        : "bg-bee-gold shadow-glow"
                  }`}
                  title={
                    spawnState === "error"
                      ? "Failed to start"
                      : spawnState === "connecting"
                        ? "Starting…"
                        : "Running"
                  }
                />
              )}
              <span className="truncate">{displayName}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {onToggleMaximize && paneWidth >= 240 && (
            <button
              onClick={onToggleMaximize}
              className="p-1.5 rounded-md hover:bg-bee-border/60 text-bee-textDim hover:text-bee-text transition-colors"
              title={isMaximized ? "Restore" : "Maximize"}
            >
              {isMaximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            </button>
          )}
          {paneWidth >= 240 && (
            <button
              onClick={handleCopy}
              className="p-1.5 rounded-md hover:bg-bee-border/60 text-bee-textDim hover:text-bee-text transition-colors"
              title="Copy selection"
            >
              <Copy size={12} />
            </button>
          )}
          {paneWidth >= 240 && (
            <button
              onClick={handleClear}
              className="p-1.5 rounded-md hover:bg-bee-border/60 text-bee-textDim hover:text-bee-text transition-colors"
              title="Clear terminal"
            >
              <Eraser size={12} />
            </button>
          )}
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
        className="flex-1 overflow-hidden relative min-h-0 p-2"
        style={{ contain: "layout paint" }}
      >
        <div ref={terminalRef} className="absolute inset-2 overflow-hidden" />
        {spawnState !== "running" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none bg-bee-canvas/70 backdrop-blur-[2px] animate-fade-in px-4 text-center">
            {spawnState === "error" ? (
              <>
                <AlertTriangle size={18} className="text-bee-err" />
                <span className="text-xs text-bee-textDim">
                  {displayName} failed to start
                </span>
              </>
            ) : (
              <>
                <Loader2 size={18} className="text-bee-gold animate-spin" />
                <span className="text-xs text-bee-textMuted">
                  Starting {displayName}…
                </span>
                {stalled && (
                  <span className="text-[11px] text-bee-warn max-w-[220px]">
                    Still nothing after {STALL_HINT_MS / 1000}s — is{" "}
                    <code className="font-mono">{workerBee.cli}</code> installed
                    and on your PATH?
                  </span>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
