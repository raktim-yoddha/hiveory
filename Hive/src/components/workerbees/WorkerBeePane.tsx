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
  Download,
  ExternalLink,
  Terminal,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore, envForCli } from "@/stores/settingsStore";
import { useWorkerBeesStore } from "@/stores/workerBeesStore";
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

// Install instructions keyed by the CLI executable name.
interface InstallInfo {
  displayName: string;
  installCmd: string;
  docsUrl: string;
  description: string;
}

const CLI_INSTALL_INFO: Record<string, InstallInfo> = {
  claude: {
    displayName: "Claude Code",
    installCmd: "npm install -g @anthropic-ai/claude-code",
    docsUrl: "https://docs.anthropic.com/en/docs/claude-code",
    description: "Anthropic's agentic coding CLI",
  },
  codex: {
    displayName: "Codex CLI",
    installCmd: "npm install -g @openai/codex",
    docsUrl: "https://github.com/openai/codex",
    description: "OpenAI Codex terminal agent",
  },
  aider: {
    displayName: "Aider",
    installCmd: "pip install aider-chat",
    docsUrl: "https://aider.chat/docs/install.html",
    description: "AI pair programming in your terminal",
  },
  agy: {
    displayName: "Antigravity CLI",
    installCmd: "npm install -g @google/antigravity-cli",
    docsUrl: "https://antigravity.google",
    description: "Google Antigravity developer suite CLI",
  },
  opencode: {
    displayName: "OpenCode",
    installCmd: "npm install -g opencode-ai",
    docsUrl: "https://opencode.ai",
    description: "Open-source AI coding assistant",
  },
  kimi: {
    displayName: "Kimi Code",
    installCmd: "pip install kimi-code",
    docsUrl: "https://kimi.moonshot.cn",
    description: "Moonshot AI coding assistant",
  },
  cline: {
    displayName: "Cline",
    installCmd: "npm install -g cline",
    docsUrl: "https://github.com/cline/cline",
    description: "Claude-powered autonomous coding agent",
  },
  cursor: {
    displayName: "Cursor CLI",
    installCmd: "# Install Cursor IDE — CLI ships with the app\ncursor --version",
    docsUrl: "https://cursor.com/downloads",
    description: "Cursor editor AI CLI",
  },
  kiro: {
    displayName: "Kiro",
    installCmd: "npm install -g kiro-cli",
    docsUrl: "https://kiro.dev",
    description: "Kiro AI coding helper",
  },
  kilo: {
    displayName: "Kilo",
    installCmd: "npm install -g kilo-ai",
    docsUrl: "https://kilo.ai",
    description: "Kilo AI terminal agent",
  },
};

// Returns true if a spawn error message indicates the executable wasn't found.
function isNotFoundError(err: unknown): boolean {
  const msg = String(err).toLowerCase();
  return (
    msg.includes("program not found") ||
    msg.includes("no such file") ||
    msg.includes("os error 2") ||
    msg.includes("the system cannot find the file") ||
    msg.includes("not recognized as an internal") ||
    msg.includes("command not found") ||
    msg.includes("cannot find the path")
  );
}

function detectCommandNotFoundError(output: string, command: string): boolean {
  const lower = output.toLowerCase();
  return (
    lower.includes("is not recognized as an internal or external command") ||
    lower.includes("not recognized as the name of a cmdlet") ||
    lower.includes("command not found") ||
    lower.includes("no such file or directory") ||
    (lower.includes("not found") && lower.includes(command.toLowerCase()))
  );
}

interface CLINotFoundCardProps {
  cli: string;
  cliName: string;
  onClose?: () => void;
}

function CLINotFoundCard({ cli, cliName, onClose }: CLINotFoundCardProps) {
  const [copied, setCopied] = useState(false);
  const info = CLI_INSTALL_INFO[cli];

  const copy = () => {
    navigator.clipboard.writeText(info?.installCmd ?? cli);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-5 animate-fade-in">
      {/* Icon + heading */}
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="w-12 h-12 rounded-2xl glass flex items-center justify-center shadow-glass">
          <Terminal size={22} className="text-bee-gold" />
        </div>
        <div>
          <p className="text-sm font-semibold text-bee-text">
            {info?.displayName ?? cliName} not installed
          </p>
          <p className="text-[11px] text-bee-textMuted mt-0.5">
            {info?.description ?? `Could not find \`${cli}\` on PATH`}
          </p>
        </div>
      </div>

      {/* Install command */}
      {info && (
        <div className="w-full max-w-[340px] space-y-2">
          <p className="text-[11px] text-bee-textDim uppercase tracking-wide font-semibold">
            Install command
          </p>
          <div className="relative rounded-xl glass border border-bee-border/70 overflow-hidden">
            <pre className="text-[11px] font-mono text-bee-gold px-3 py-2.5 pr-10 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
              {info.installCmd}
            </pre>
            <button
              onClick={copy}
              className="absolute top-2 right-2 p-1.5 rounded-md bg-bee-border/40 hover:bg-bee-gold/20 text-bee-textDim hover:text-bee-gold transition-all"
              title="Copy install command"
            >
              {copied ? (
                <span className="text-[10px] text-bee-gold font-semibold">✓</span>
              ) : (
                <Copy size={11} />
              )}
            </button>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 flex-wrap justify-center">
        {info?.docsUrl && (
          <a
            href={info.docsUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-bee-gold/10 border border-bee-gold/25 text-bee-goldHi hover:bg-bee-gold/20 transition-colors"
          >
            <ExternalLink size={12} />
            Open docs
          </a>
        )}
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs glass border border-bee-border/70 text-bee-textDim hover:text-bee-text transition-colors"
        >
          <Trash2 size={12} />
          Remove pane
        </button>
      </div>
    </div>
  );
}

// A freshly-scaffolded memory file is just its placeholder HTML comment —
// FTS5 will happily "match" that noise against broad keywords. AGENTS.md
// §4.2.4: "if nothing clears a minimum relevance threshold, inject nothing."
function isMeaningfulChunk(content: string): boolean {
  return content.replace(/<!--[\s\S]*?-->/g, "").trim().length > 0;
}

// Bootstrap query surfaces general project context AND recent session handoff data.
const BOOTSTRAP_QUERY =
  "project overview architecture conventions decisions patterns bugs knowledge session handoff previous task agent history";

// Injected context is written straight into the pty's stdin, not typed by a
// human through xterm's own paste handling. Almost every CLI chat input
// (readline, Ink, prompt_toolkit, ...) treats a bare `\n` as "Enter pressed,"
// not "insert newline" — so a multi-line context blob piped in raw arrives
// as dozens of fragmentary submissions instead of one coherent message, and
// the agent never actually sees the context as intended. Flattening to a
// single line guarantees it lands as one atomic input regardless of whether
// the receiving CLI honors bracketed-paste mode (support for that is
// inconsistent across CLIs and flaky over a raw Windows ConPTY passthrough).
function flattenForStdin(text: string): string {
  return text.replace(/\r?\n+/g, " ").replace(/\s{2,}/g, " ").trim();
}

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
  const [spawnState, setSpawnState] = useState<"connecting" | "running" | "error" | "notFound">("connecting");
  const [stalled, setStalled] = useState(false);
  const apiKeys = useSettingsStore((s) => s.apiKeys);
  const nectarTokenBudget = useSettingsStore((s) => s.nectarTokenBudget);

  const [paneWidth, setPaneWidth] = useState(0);
  const [paneHeight, setPaneHeight] = useState(0);
  const refitCount = useWorkerBeesStore((s) => s.refitCount);

  // Re-fit xterm whenever a global refit signal fires (tab switch / maximize
  // restore). Kept separate from the spawn effect so this never re-spawns.
  useEffect(() => {
    if (!fitAddonRef.current || !terminalRef.current) return;
    const rect = terminalRef.current.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      try { fitAddonRef.current.fit(); } catch {}
    }
  }, [refitCount]);

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
    let liveHandoffInterval: ReturnType<typeof setInterval> | null = null;
    let spawnDir = workingDir;
    const transcriptRef = { current: "" };
    let summarySaved = false;
    let lastFlushedLength = 0;

    // Shared by the final save (on close/exit) and the periodic live flush
    // below — appends one entry to agents/handoffs.md, capped so the file
    // (and what gets injected into the next agent) stays focused on recent
    // sessions instead of growing forever.
    const appendHandoffEntry = async (
      nectarInstance: Nectar,
      transcript: string,
      label: string,
    ) => {
      const dateStr = new Date().toISOString();
      const handoffLines = transcript
        .split('\n')
        .filter(line => line.trim().length > 2)
        .filter(line => !/^[─═━\-=\s]{4,}$/.test(line.trim()));
      const handoffExcerpt = handoffLines.join('\n').slice(-1200).replace(/`/g, "'");
      const handoffEntry = `\n## [${dateStr.split('T')[0]}] ${workerBee.cliName} (${workerBee.cli}) ${label}\n\nChars: ${transcript.length}\n\n### Session Excerpt (last ~1200 chars)\n\n${handoffExcerpt || "(no readable output yet)"}\n`;

      let existingHandoff = "";
      try {
        const hf = await nectarInstance.readMemoryFile("agents/handoffs.md");
        existingHandoff = hf.content;
      } catch {}

      const handoffHeader = "# Handoffs\n\nWhat each agent left for the next one.\n";
      const priorBody = existingHandoff.includes("# Handoffs")
        ? existingHandoff.slice(existingHandoff.indexOf(handoffHeader) + handoffHeader.length)
        : existingHandoff;
      const cappedBody = (priorBody + handoffEntry).slice(-6000);
      await nectarInstance.writeMemoryFile("agents/handoffs.md", handoffHeader + cappedBody);
    };

    const saveSessionSummary = async (transcript: string) => {
      if (summarySaved) return;
      summarySaved = true;

      // Resolve the best available project dir — needed for Nectar.create()
      let saveDir = spawnDir;
      if (!saveDir) {
        try { saveDir = await invoke<string>("get_project_path"); } catch {}
      }
      if (!saveDir) {
        try { saveDir = await invoke<string>("get_home_dir"); } catch {}
      }

      if (!saveDir) {
        console.warn(`[Nectar] Cannot save session: no project dir available for ${paneId}`);
        return;
      }

      const sessionId = `session-${Date.now()}`;
      const cleanTranscript = transcript.trim();
      const dateStr = new Date().toISOString();
      console.log(`[Nectar] Saving session ${sessionId} for ${workerBee.cliName} in ${saveDir} (${cleanTranscript.length} chars)`);

      try {
        const nectarInstance = await Nectar.create(saveDir);

        // Step 1: Write the raw session log immediately (no AI dependency)
        const rawSessionContent = `# ${workerBee.cliName} Session Log\n\nDate: ${dateStr}\nAgent: ${workerBee.cli}\nProject: ${saveDir}\n\n## Raw Transcript\n\n\`\`\`\n${cleanTranscript || "(empty session)"}\n\`\`\`\n`;

        await nectarInstance.writeMemoryFile(
          `agents/sessions/${sessionId}.md`,
          rawSessionContent,
          { agent: workerBee.cli, timestamp: Date.now() }
        );
        console.log(`[Nectar] ✓ Session log written: agents/sessions/${sessionId}.md`);

        // Step 1b: Update agents/handoffs.md — this is what the NEXT agent will always read.
        // It's compact (no full transcript) and always indexed on next pane spawn.
        await appendHandoffEntry(nectarInstance, cleanTranscript, "(session ended)");
        console.log(`[Nectar] ✓ Handoff written to agents/handoffs.md`);

        // Step 2: Optionally enrich with AI summary if transcript is substantial
        if (cleanTranscript.length >= 50) {
          generateAIExtractedSummary(cleanTranscript, workerBee.cliName, apiKeys).then(async (summary) => {
            if (!summary) return;
            try {
              // Overwrite the session file with enriched content
              const enrichedContent = `# ${workerBee.cliName} Session Summary\n\nDate: ${dateStr}\nAgent: ${workerBee.cli}\nProject: ${saveDir}\n\n## Changes\n\n${summary.changes.map((c: string) => `- ${c}`).join('\n')}\n\n## Decisions\n\n${summary.decisions.map((d: any) => `- [${d.type}] ${d.description}`).join('\n')}\n\n## Raw Transcript\n\n\`\`\`\n${cleanTranscript}\n\`\`\`\n`;
              await nectarInstance.writeMemoryFile(
                `agents/sessions/${sessionId}.md`,
                enrichedContent,
                { agent: workerBee.cli, timestamp: Date.now() }
              );

              // Append decisions to appropriate memory files
              for (const decision of summary.decisions) {
                let targetFile = 'memory/knowledge.md';
                if (decision.type === 'architecture') targetFile = 'memory/decisions.md';
                else if (decision.type === 'convention') targetFile = 'memory/conventions.md';
                else if (decision.type === 'bug_fix') targetFile = 'memory/bugs.md';

                let existingContent = "";
                try {
                  const fileData = await nectarInstance.readMemoryFile(targetFile);
                  existingContent = fileData.content;
                } catch {}

                await nectarInstance.writeMemoryFile(
                  targetFile,
                  existingContent + `\n## [${dateStr.split('T')[0]}] ${workerBee.cliName} Session\n\n${decision.description}\n`
                );
                console.log(`[Nectar] ✓ Decision appended to ${targetFile}`);
              }
            } catch (e) {
              console.error("[Nectar] Failed to enrich session with AI summary:", e);
            }
          }).catch(e => console.error("[Nectar] AI summarization error:", e));
        }
      } catch (e) {
        console.error(`[Nectar] Failed to save session log for ${paneId}:`, e);
      }
    };


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

        // Periodically snapshot the live transcript into agents/handoffs.md
        // (not just on close). AGENTS.md's v1 scope is one agent per pane —
        // but nothing stops a second WorkerBee being opened alongside a
        // still-running one, and it should see reasonably fresh context
        // without forcing the user to close the first one first.
        liveHandoffInterval = setInterval(async () => {
          if (disposed || !spawnDir) return;
          const transcript = transcriptRef.current.trim();
          if (transcript.length - lastFlushedLength < 200) return;
          lastFlushedLength = transcript.length;
          try {
            const nectarInstance = await Nectar.create(spawnDir);
            await appendHandoffEntry(nectarInstance, transcript, "(in progress)");
          } catch (e) {
            console.warn(`[Nectar] Live handoff flush failed for ${paneId}:`, e);
          }
        }, 45000);

        let checkAliveCounter = 0;
        const readOutput = async () => {
          while (!disposed) {
            try {
              const output = await invoke<string>("read_from_terminal", { paneId });
              if (output && !disposed && terminal) {
                if (detectCommandNotFoundError(output, command)) {
                  setSpawnState("notFound");
                  invoke("kill_terminal", { paneId }).catch(console.error);
                  if (stallTimer) {
                    clearTimeout(stallTimer);
                    stallTimer = null;
                  }
                  return; // Stop reading loop!
                }

                // Append output to transcript ref, stripping color codes/non-printables where possible
                // to make the transcript clean for LLM consumption
                const cleanOutput = output.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, "");
                transcriptRef.current = (transcriptRef.current + cleanOutput).slice(-50000);

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

            // Periodically check if the child process has terminated
            checkAliveCounter++;
            if (checkAliveCounter >= 40) {
              checkAliveCounter = 0;
              try {
                const alive = await invoke<boolean>("is_process_alive", { paneId });
                if (!alive) {
                  console.log(`[WorkerBeePane - ${paneId}] Process exited naturally. Saving session summary...`);
                  saveSessionSummary(transcriptRef.current);
                  break; // Exit reader loop
                }
              } catch (e) {
                console.error("is_process_alive check failed:", e);
              }
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

              // Wait for the CLI to boot AND for any previous session's Nectar
              // writes (handoffs.md, session logs) to flush to disk before we
              // re-index. 1800ms covers CLI boot time + async IPC write latency
              // from a just-closed WorkerBee pane.
              await new Promise((resolve) => setTimeout(resolve, 1800));
              if (disposed || !terminal) return;

              // Re-index AFTER the delay so handoff writes from the previous
              // session are on disk and picked up by the FTS5/vector index.
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

              // Handoffs are direct cross-agent continuity data — "what the
              // last agent left for the next one" — not something that
              // should depend on fuzzy FTS5 keyword relevance. Read it
              // directly and unconditionally. `listMemoryFiles()` only scans
              // `.nectar/memory/`, never `.nectar/agents/`, so handoffs.md
              // was written correctly by every session but never actually
              // surfaced to the next one — this is the fix for "the next
              // CLI doesn't know what the previous one did."
              let handoffText = "";
              try {
                const hf = await nectar.readMemoryFile("agents/handoffs.md");
                handoffText = hf.content.trim();
              } catch {
                // No handoff file yet — first session for this project.
              }

              if (meaningful.length === 0 && !handoffText) {
                if (!disposed && terminal) {
                  terminal.writeln(
                    `\x1b[38;5;242m[nectar] no project memory yet — context will build after your first session\x1b[0m`,
                  );
                }
                return;
              }

              if (disposed || !terminal) return;

              let formattedMemory = "";
              if (meaningful.length > 0) {
                const resp = await nectar.formatContext(workerBee.cli, meaningful);
                formattedMemory = resp.formatted_text;
              }

              const sections: string[] = [];
              if (handoffText) {
                sections.push(`### Previous agent sessions (handoff notes)\n\n${handoffText}`);
              }
              if (formattedMemory) {
                sections.push(`### Project memory\n\n${formattedMemory}`);
              }
              const combined = sections.join("\n\n---\n\n");
              if (!combined) return;

              terminal.writeln(
                `\x1b[38;5;178m[nectar] injecting context (${handoffText ? "handoff + " : ""}${meaningful.length} memory chunk(s))\x1b[0m`,
              );
              // Prefix with an explicit preamble so the CLI knows this is prior
              // session context and can answer "what was done before" questions.
              const contextPreamble = `[HIVEORY NECTAR CONTEXT — read this before responding]
This project uses Hiveory Nectar for cross-agent memory. The following is your
project memory and handoff notes from previous AI agent sessions. You MUST
use this context to answer any question about what was previously done,
decided, or changed in this project:

`;
              writeToProcess(flattenForStdin(contextPreamble + combined) + "\r");

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
        if (isNotFoundError(e)) {
          // Don't write anything to the xterm buffer — show the install UI instead.
          if (!disposed) setSpawnState("notFound");
        } else {
          if (!disposed && terminal) {
            terminal.writeln(`\x1b[31mFailed to spawn ${displayName}: ${e}\x1b[0m`);
          }
          if (!disposed) setSpawnState("error");
        }
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
      if (liveHandoffInterval) clearInterval(liveHandoffInterval);
      if (handleResize) window.removeEventListener("resize", handleResize);
      observerRef?.disconnect();
      onDataDisposable?.dispose();

      // Trigger automatic Nectar memory summary on session end/close
      saveSessionSummary(transcriptRef.current);

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
        {/* xterm canvas — hidden (not unmounted) when CLI isn't installed */}
        <div
          ref={terminalRef}
          className={`absolute inset-2 overflow-hidden ${spawnState === "notFound" ? "invisible" : ""}`}
        />

        {/* CLI not found — rich install card, replaces xterm entirely */}
        {spawnState === "notFound" && (
          <CLINotFoundCard
            cli={workerBee.cli}
            cliName={workerBee.cliName}
            onClose={onClose}
          />
        )}

        {/* Loading / generic error overlay */}
        {spawnState !== "running" && spawnState !== "notFound" && (
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

interface ExtractedSummary {
  changes: string[];
  decisions: Array<{
    type: 'architecture' | 'convention' | 'bug_fix' | 'general';
    description: string;
  }>;
}

async function generateAIExtractedSummary(
  transcript: string,
  cliName: string,
  apiKeys: any
): Promise<ExtractedSummary | null> {
  const prompt = `Analyze this raw command line coding session transcript for the AI assistant "${cliName}".
Extract:
1. Any specific code or project changes made (e.g. file edits, additions, deletions).
2. Any major decisions made, categorized into:
   - "architecture" (e.g., system design choices, libraries, module boundaries)
   - "convention" (e.g., style guidelines, patterns, naming choices)
   - "bug_fix" (e.g., fixed unique constraint in db, fixed type errors)
   - "general" (e.g., other project knowledge learned)

Respond ONLY with a JSON object of this structure, without markdown formatting or code blocks:
{
  "changes": ["string"],
  "decisions": [
    {
      "type": "architecture" | "convention" | "bug_fix" | "general",
      "description": "string"
    }
  ]
}

Transcript:
${transcript}`;

  // Try Google Gemini
  if (apiKeys.google) {
    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKeys.google}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: "application/json" }
          })
        }
      );
      const data = await resp.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return JSON.parse(text);
    } catch (e) {
      console.warn("Gemini summarization failed, trying next provider:", e);
    }
  }

  // Try OpenAI
  if (apiKeys.openai) {
    try {
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKeys.openai}`
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" }
        })
      });
      const data = await resp.json();
      const text = data?.choices?.[0]?.message?.content;
      if (text) return JSON.parse(text);
    } catch (e) {
      console.warn("OpenAI summarization failed:", e);
    }
  }

  // Fallback (Offline fallback)
  return {
    changes: ["AI session completed. No LLM API key was available to extract specific changes."],
    decisions: [
      {
        type: "general",
        description: `Session completed. Configure API keys in Settings to enable automatic Nectar memory synthesis.`
      }
    ]
  };
}
