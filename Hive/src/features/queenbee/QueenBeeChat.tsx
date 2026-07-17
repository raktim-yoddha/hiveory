"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Settings, Pin, PinOff, ExternalLink, ClipboardList, Search, ShieldCheck, ChevronDown, type LucideIcon } from "lucide-react";
import { MODE_SYSTEM_PROMPTS, detectModeIntent, type QueenBeeMode } from "@hiveory/queenbee";
import type { ColumnId } from "@hiveory/taskcomb";
import { useSettingsStore } from "@/features/settings/settingsStore";
import { useProviderStore } from "@/features/settings/providerStore";
import { useWorkspaceStore } from "@/features/workspaces/workspaceStore";
import { useWorkerBeesStore, type GridLayout } from "@/features/worker-bees/workerBeesStore";
import { useUiStore } from "@/shared/uiStore";
import { useBrowserStore } from "@/features/browser/browserStore";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import {
  toAnthropicTools,
  toOpenAITools,
  executeTool,
  ToolError,
  ASYNC_TOOLS,
  type ToolContext,
} from "@/features/queenbee/queenbeeTools";
import { useProjectStore } from "@/shared/projectStore";
import { useDispatchStore } from "@/features/orchestration/dispatchStore";
import { dispatchGoal, approveTask } from "@/features/orchestration/dispatch";
import { Nectar } from "@/features/memory/nectar";
import { invoke } from "@tauri-apps/api/core";

interface Message {
  id: string;
  text: string;
  sender: "user" | "agent";
  timestamp: Date;
}

// UI-only mode icons — domain logic (prompts, intent, labels) lives in @hiveory/queenbee.
const MODE_ICONS: Record<QueenBeeMode, LucideIcon> = {
  Steward: ClipboardList,
  Forager: Search,
  Stinger: ShieldCheck,
};

// Full role labels shown in the QueenBee selector dropdown.
const MODE_LABELS: Record<QueenBeeMode, string> = {
  Steward: "Steward Manager",
  Forager: "Forager Reviewer",
  Stinger: "Stinger Security",
};

interface QueenBeeChatProps {
  docked?: boolean;
  onToggleDock?: () => void;
  onOpenSettings?: () => void;
  onOpenProject?: () => void;
}

export default function QueenBeeChat({ docked, onToggleDock, onOpenSettings, onOpenProject }: QueenBeeChatProps) {
  const [activeMode, setActiveMode] = useState<QueenBeeMode>("Steward");
  const welcomeText: Record<QueenBeeMode, string> = {
    Steward: "I'm QueenBee Steward. Tell me what you want to build and I'll dispatch WorkerBees to execute the work.",
    Forager: "I'm QueenBee Forager. I'll proactively scan the codebase for bugs and issues.",
    Stinger: "I'm QueenBee Stinger. I'll audit your code for security vulnerabilities.",
  };

  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      text: welcomeText.Steward,
      sender: "agent",
      timestamp: new Date(),
    },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [showModeMenu, setShowModeMenu] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const queenbeeModel = useSettingsStore((s) => s.queenbeeModel);
  const setQueenbeeModel = useSettingsStore((s) => s.setQueenbeeModel);
  const availableModels = useProviderStore((s) => s.availableModels);
  const providers = useProviderStore((s) => s.providers);
  const hasConnectedProviders = providers.some((p) => p.verified && p.enabled);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const findProviderForModel = () => {
    const modelEntry = availableModels.find((m) => m.model === queenbeeModel);
    if (modelEntry) {
      const p = providers.find((pr) => pr.id === modelEntry.providerId);
      return p || null;
    }
    const knownMap: Record<string, string> = {
      "anthropic": "anthropic",
      "openai": "openai",
      "google": "google",
      "opencode": "opencode",
      "openrouter": "openrouter",
    };
    const prefix = queenbeeModel.split("/")[0];
    const knownId = knownMap[prefix];
    if (knownId) {
      return providers.find((p) => p.id === knownId) || null;
    }
    return providers.find((p) => p.apiKey) || providers[0] || null;
  };

  // Bind QueenBee's tools to the live stores. Reads getState() fresh on each
  // call so tool results reflect prior tool mutations within the same turn.
  const buildToolContext = (): ToolContext => {
    const effectiveWsId = () => {
      const s = useWorkspaceStore.getState();
      return s.activeWorkspaceId || s.workspaces[0]?.id || "";
    };
    const activeWorkspace = () => {
      const s = useWorkspaceStore.getState();
      return s.workspaces.find((w) => w.id === effectiveWsId());
    };
    return {
      createWorkspace: (name) => {
        const id = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        useWorkspaceStore.getState().addWorkspace({
          id, name, color: "#c9a227", boundProjectPath: "",
          paneLayout: [], taskCards: [],
        });
        return id;
      },
      listWorkspaces: () =>
        useWorkspaceStore.getState().workspaces.map((w) => ({ id: w.id, name: w.name })),
      addTask: (title, description) =>
        useWorkspaceStore.getState().addTask(effectiveWsId(), title, description),
      listTasks: () =>
        (activeWorkspace()?.taskCards ?? []).map((t) => ({ id: t.id, title: t.title, column: t.column })),
      moveTask: (taskId, column) => {
        const w = activeWorkspace();
        if (!w || !w.taskCards.some((t) => t.id === taskId)) return false;
        useWorkspaceStore.getState().moveTask(w.id, taskId, column as ColumnId);
        return true;
      },
      launchWorkerBee: (cli, name) =>
        useWorkerBeesStore.getState().addWorkerBee({
          id: `bee-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          cli, cliName: cli, customName: name,
        }),
      launchTerminal: (name) =>
        useWorkerBeesStore.getState().addWorkerBee({
          id: `terminal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          cli: "shell", cliName: "Terminal", customName: name, kind: "shell",
        }),
      setBoardOpen: (open) => useWorkspaceStore.getState().setBoardOpen(open),
      openSettings: () => {
        if (!onOpenSettings) return false;
        onOpenSettings();
        return true;
      },
      deleteWorkspace: (id) => {
        const s = useWorkspaceStore.getState();
        if (!s.workspaces.some((w) => w.id === id)) return false;
        s.deleteWorkspace(id);
        return true;
      },
      renameWorkspace: (id, name) => {
        const s = useWorkspaceStore.getState();
        if (!s.workspaces.some((w) => w.id === id)) return false;
        s.renameWorkspace(id, name);
        return true;
      },
      recolorWorkspace: (id, color) => {
        const s = useWorkspaceStore.getState();
        if (!s.workspaces.some((w) => w.id === id)) return false;
        s.setWorkspaceColor(id, color);
        return true;
      },
      switchWorkspace: (id) => {
        const s = useWorkspaceStore.getState();
        if (!s.workspaces.some((w) => w.id === id)) return false;
        s.setActiveWorkspace(id);
        return true;
      },
      listWorkerBees: () =>
        useWorkerBeesStore.getState().workerBees.map((b) => ({
          id: b.id, name: b.customName || b.cliName || b.cli, cli: b.cli,
        })),
      removeWorkerBee: (id) => {
        const s = useWorkerBeesStore.getState();
        if (!s.workerBees.some((b) => b.id === id)) return false;
        s.removeWorkerBee(id);
        return true;
      },
      renameWorkerBee: (id, name) => {
        const s = useWorkerBeesStore.getState();
        if (!s.workerBees.some((b) => b.id === id)) return false;
        s.updateWorkerBee(id, { customName: name });
        return true;
      },
      reorderWorkerBee: (from, to) => {
        const s = useWorkerBeesStore.getState();
        const n = s.workerBees.length;
        if (from < 0 || from >= n || to < 0 || to >= n) return false;
        s.reorderWorkerBees(from, to);
        return true;
      },
      setDefaultWorkerBee: (cli) => useSettingsStore.getState().setDefaultWorkerBee(cli),
      setGridLayout: (layout) => {
        const named = ["auto", "grid", "cols", "rows", "master"];
        const value: GridLayout = named.includes(layout)
          ? (layout as GridLayout)
          : (Number(layout) as GridLayout);
        useWorkerBeesStore.getState().setGridLayout(value);
      },
      maximizePane: (id) => useWorkerBeesStore.getState().setMaximizedPane(id),
      refitTerminals: () => useWorkerBeesStore.getState().refitTerminals(),
      setLeftSidebar: (open) => useUiStore.getState().setLeftOpen(open),
      setRightDock: (open) => useUiStore.getState().setRightOpen(open),
    };
  };

  const runTool = async (name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<string> => {
    try {
      if (ASYNC_TOOLS.has(name)) {
        const projectPath = useProjectStore.getState().projectPath || "";

        // Drive the browser pane and capture what it shows. The image itself is
        // attached to the tool result by callApi — this only reports the outcome.
        if (name === "capture_browser_screenshot") {
          const url = args.url ? String(args.url) : undefined;
          const shot = await useBrowserStore.getState().captureActive(url);
          if (!shot) return "No browser pane is open. Ask the user to click Browser in the toolbar first.";
          return `Screenshot captured of ${shot.url} (attached).`;
        }

        // Read-only memory tools — available to every mode (Forager/Stinger need
        // to read the project's memory to audit it).
        if (name === "list_memory_files" || name === "read_memory_file" || name === "search_memory") {
          if (!projectPath) throw new ToolError("No project is open.");
          const nectar = new Nectar(projectPath);
          if (name === "list_memory_files") {
            const res = await nectar.listMemoryFiles();
            const files = res?.files ?? [];
            return files.length ? files.map((f: string) => `- ${f}`).join("\n") : "No memory files.";
          }
          if (name === "read_memory_file") {
            const path = String(args.path || "");
            if (!path) throw new ToolError('Missing required argument "path" for read_memory_file.');
            const res = await nectar.readMemoryFile(path);
            return res?.content || `(empty or missing: ${path})`;
          }
          const query = String(args.query || "");
          if (!query) throw new ToolError('Missing required argument "query" for search_memory.');
          const res = await nectar.search(query, { limit: 5 });
          const hits = res?.results ?? [];
          return hits.length
            ? hits.map((h: any) => `- [${h.score?.toFixed?.(3) ?? "?"}] ${h.chunk?.source_file ?? "?"}: ${String(h.chunk?.content ?? "").slice(0, 200)}`).join("\n")
            : "No memory matches.";
        }

        if (name === "list_dispatched") {
          const items = useDispatchStore.getState().dispatched;
          return items.length
            ? items.map((d) => `- ${d.taskId}: ${d.title} (${d.cli}) @ ${d.branch}`).join("\n")
            : "Nothing dispatched is awaiting approval.";
        }

        if (activeMode !== "Steward") throw new ToolError(`Tool "${name}" is not available in ${activeMode} mode.`);

        if (name === "write_memory") {
          if (!projectPath) throw new ToolError("No project is open.");
          const path = String(args.path || "");
          const content = String(args.content ?? "");
          if (!path) throw new ToolError('Missing required argument "path" for write_memory.');
          const nectar = new Nectar(projectPath);
          await nectar.writeMemoryFile(path, content);
          return `Wrote ${content.length} chars to .nectar/memory/${path}.`;
        }

        if (name === "open_project") {
          if (!onOpenProject) throw new ToolError("Can't open the folder picker from here.");
          onOpenProject();
          return "Opened the folder picker — choose a project.";
        }

        if (name === "open_url") {
          const url = String(args.url || "http://localhost:3000");
          await shellOpen(url);
          return `Opened ${url} in the browser.`;
        }

        if (name === "approve_task") {
          const taskId = String(args.taskId || "");
          if (!taskId) throw new ToolError('Missing required argument "taskId" for approve_task.');
          const entry = useDispatchStore.getState().get(taskId);
          if (!entry) throw new ToolError(`No dispatched task "${taskId}" awaiting approval.`);
          if (!projectPath) throw new ToolError("No project is open.");
          // Go through HiveMind so the merge also releases file locks and marks
          // the registry + handoff merged — a bare merge_worktree leaves the
          // orchestrator believing the task still owns its files.
          const { viaOrchestrator } = await approveTask(projectPath, taskId, {
            branch: entry.branch,
            worktreePath: entry.worktreePath,
          });
          useDispatchStore.getState().remove(taskId);
          return `Merged ${entry.branch} into the project and removed its worktree.${
            viaOrchestrator ? " Locks released." : ""
          }`;
        }

        if (name === "dispatch_goal") {
          const goal = String(args.goal || "");
          if (!goal) throw new ToolError('Missing required argument "goal" for dispatch_goal.');
          const results = await dispatchGoal(goal, projectPath, {
            launchWorkerBee: (cli, displayName, cwd) =>
              useWorkerBeesStore.getState().addWorkerBee({
                id: `bee-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                cli, cliName: cli, customName: displayName, args: cwd ? ["--cwd", cwd] : undefined,
              }),
            addCard: (title, description) => {
              const s = useWorkspaceStore.getState();
              s.addTask(s.activeWorkspaceId || s.workspaces[0]?.id || "", title, description);
            },
          });
          // Remember each worktree so approve_task can merge it later.
          for (const r of results) {
            if (r.worktree && !r.error) {
              useDispatchStore.getState().record({
                taskId: r.taskId,
                title: r.title,
                cli: r.cli,
                branch: r.worktree.branch,
                worktreePath: r.worktree.path,
              });
            }
          }
          // A lock-blocked task has no error and no worktree — it must not be
          // reported as dispatched, or QueenBee will claim work that never ran.
          const blocked = results.filter((r) => r.blockedBy?.length);
          const failed = results.filter((r) => r.error);
          const ok = results.filter((r) => !r.error && !r.blockedBy?.length);
          const lines = results.map((r) => {
            if (r.error) return `- ✗ ${r.title}: ${r.error}`;
            if (r.blockedBy?.length) {
              const who = r.blockedBy.map((c) => `${c.filePath} (owned by ${c.existingOwner})`).join(", ");
              return `- ⊘ ${r.title}: blocked — ${who}`;
            }
            return `- ✓ ${r.title} (${r.cli})${r.worktree ? ` @ ${r.worktree.branch}` : ""}`;
          });
          const suffix = [
            failed.length ? `${failed.length} failed` : "",
            blocked.length ? `${blocked.length} blocked` : "",
          ].filter(Boolean).join(", ");
          return `Dispatched ${ok.length}/${results.length} task(s)${suffix ? `, ${suffix}` : ""}:\n${lines.join("\n")}`;
        }
      }
      return executeTool(activeMode, name, args, ctx);
    } catch (e) {
      if (e instanceof ToolError) return `Error: ${e.message}`;
      return `Error: ${(e as Error)?.message || "tool failed"}`;
    }
  };

  const callApi = async (message: string): Promise<string> => {
    const provider = findProviderForModel();
    const apiKey = provider?.apiKey || "";

    if (!apiKey) {
      return `[${activeMode}] No API key configured for model "${queenbeeModel}". Connect a provider in Settings.`;
    }

    const history = messages
      .filter(m => m.id !== "welcome")
      .slice(-10)
      .map(m => ({ role: m.sender === "user" ? "user" : "assistant", content: m.text }));

    const systemPrompt = MODE_SYSTEM_PROMPTS[activeMode];
    const ctx = buildToolContext();
    const MAX_TURNS = 6; // cap the tool-use loop so a misbehaving model can't spin forever

    try {
      const isAnthropic = provider?.apiType === "anthropic-messages";
      const baseUrl = provider?.baseUrl?.replace(/\/+$/, "") || "";

      if (isAnthropic) {
        const model = queenbeeModel.replace("anthropic/", "");
        const tools = toAnthropicTools(activeMode);
        const msgs: any[] = [...history, { role: "user", content: message }];

        for (let turn = 0; turn < MAX_TURNS; turn++) {
          const resp = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({ model, system: systemPrompt, messages: msgs, tools, max_tokens: 1000 }),
          });
          const data = await resp.json();
          const blocks: any[] = Array.isArray(data?.content) ? data.content : [];
          const text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
          const toolUses = blocks.filter((b) => b.type === "tool_use");

          if (toolUses.length === 0) {
            return text || `[${activeMode}] No response from model.`;
          }

          // Execute each tool call, feed results back, loop.
          msgs.push({ role: "assistant", content: blocks });
          const toolResults = await Promise.all(
            toolUses.map(async (tu) => {
              const text = await runTool(tu.name, tu.input || {}, ctx);
              // Anthropic accepts image blocks inside tool_result, so the model
              // actually sees the page rather than a description of it.
              if (tu.name === "capture_browser_screenshot") {
                const shot = useBrowserStore.getState().latestScreenshot();
                if (shot) {
                  return {
                    type: "tool_result",
                    tool_use_id: tu.id,
                    content: [
                      { type: "text", text },
                      { type: "image", source: { type: "base64", media_type: "image/png", data: shot.data } },
                    ],
                  };
                }
              }
              return { type: "tool_result", tool_use_id: tu.id, content: text };
            }),
          );
          msgs.push({ role: "user", content: toolResults });
        }
        return `[${activeMode}] Stopped after ${MAX_TURNS} tool turns.`;
      }

      // OpenAI-compatible chat completions
      const model = queenbeeModel.includes("/") ? queenbeeModel.split("/").slice(1).join("/") : queenbeeModel;
      const tools = toOpenAITools(activeMode);
      const msgs: any[] = [
        { role: "system", content: systemPrompt },
        ...history,
        { role: "user", content: message },
      ];

      for (let turn = 0; turn < MAX_TURNS; turn++) {
        const resp = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            ...(provider?.headers || {}),
          },
          body: JSON.stringify({ model, messages: msgs, tools, tool_choice: "auto", max_tokens: 1000 }),
        });
        const data = await resp.json();
        const choice = data?.choices?.[0]?.message;
        const toolCalls: any[] = choice?.tool_calls || [];

        if (toolCalls.length === 0) {
          return choice?.content || `[${activeMode}] No response from model.`;
        }

        msgs.push(choice);
        let capturedShot: { data: string; url: string } | null = null;
        for (const tc of toolCalls) {
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(tc.function?.arguments || "{}"); } catch { /* leave empty; runTool reports missing args */ }
          msgs.push({
            role: "tool",
            tool_call_id: tc.id,
            content: await runTool(tc.function?.name, args, ctx),
          });
          if (tc.function?.name === "capture_browser_screenshot") {
            capturedShot = useBrowserStore.getState().latestScreenshot();
          }
        }
        // OpenAI tool messages are text-only, so the image rides along as a
        // follow-up user turn (allowed straight after tool results).
        if (capturedShot) {
          msgs.push({
            role: "user",
            content: [
              { type: "text", text: `Browser screenshot of ${capturedShot.url}:` },
              { type: "image_url", image_url: { url: `data:image/png;base64,${capturedShot.data}` } },
            ],
          });
        }
      }
      return `[${activeMode}] Stopped after ${MAX_TURNS} tool turns.`;
    } catch (e: any) {
      console.error(`[QueenBee/${activeMode}] API error:`, e);
      return `[${activeMode}] Error: ${e?.message || "API call failed"}`;
    }
  };

  const handleModeSwitch = (newMode: QueenBeeMode) => {
    setActiveMode(newMode);
    setShowModeMenu(false);
  };

  const handleSend = async () => {
    if (!inputValue.trim() || thinking) return;

    const userText = inputValue.trim();

    const detectedMode = detectModeIntent(userText);
    if (detectedMode && detectedMode !== activeMode) {
      setActiveMode(detectedMode);
    }

    const userMsg: Message = {
      id: `msg-${Date.now()}`,
      text: userText,
      sender: "user",
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInputValue("");
    setThinking(true);

    const responseText = await callApi(userMsg.text);

    const agentMsg: Message = {
      id: `msg-${Date.now()}-resp`,
      text: responseText,
      sender: "agent",
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, agentMsg]);
    setThinking(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="h-full w-full glass-hi border-l border-bee-border/60 flex flex-col">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-bee-border/50 relative">
        <div className="relative">
          <button
            onClick={() => setShowModeMenu(!showModeMenu)}
            className="flex items-center gap-1.5 text-xs font-semibold text-bee-gold hover:text-bee-goldHi transition-colors"
          >
            QueenBee
            <ChevronDown size={10} className="opacity-70" />
          </button>
          {showModeMenu && (
            <div className="absolute left-0 top-full mt-1 glass-hi rounded-lg z-50 min-w-40 p-1 animate-fade-in">
              {(["Steward", "Forager", "Stinger"] as QueenBeeMode[]).map((mode) => {
                const Icon = MODE_ICONS[mode];
                return (
                  <button
                    key={mode}
                    onClick={() => handleModeSwitch(mode)}
                    className={`flex items-center gap-2 w-full px-2.5 py-1.5 text-left text-xs rounded-md transition-colors ${
                      activeMode === mode
                        ? "bg-bee-gold/10 text-bee-goldHi"
                        : "text-bee-textDim hover:text-bee-text hover:bg-bee-border/40"
                    }`}
                  >
                    <Icon size={13} className="shrink-0 text-bee-gold" />
                    {MODE_LABELS[mode]}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-bee-textMuted font-mono">{activeMode}</span>
          <button
            onClick={onToggleDock}
            className="p-1 rounded-md hover:bg-bee-border/60 text-bee-textMuted hover:text-bee-text transition-colors"
            title={docked ? "Switch to floating overlay" : "Dock to side"}
          >
            {docked ? <PinOff size={12} /> : <Pin size={12} />}
          </button>
          <button
            onClick={() => setShowConfig(!showConfig)}
            className="p-1 rounded-md hover:bg-bee-border/60 text-bee-textMuted hover:text-bee-text transition-colors"
            title="QueenBee model config"
          >
            <Settings size={12} />
          </button>
        </div>
      </div>

      {showConfig && (
        <div className="px-3 py-2 border-b border-bee-border/50 bg-bee-canvas/40 space-y-2">
          {!hasConnectedProviders ? (
            <div className="text-[10px] text-bee-textMuted space-y-2">
              <p>No providers connected.</p>
              <a
                onClick={onOpenSettings}
                className="inline-flex items-center gap-1 text-bee-gold hover:text-bee-goldHi transition-colors cursor-pointer"
              >
                <ExternalLink size={10} />
                Connect a provider in Settings
              </a>
            </div>
          ) : availableModels.length === 0 ? (
            <div className="text-[10px] text-bee-textMuted">
              <p>Connected providers have no models.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <label className="text-[9px] text-bee-textMuted uppercase tracking-wider">Model</label>
              <select
                value={queenbeeModel}
                onChange={(e) => setQueenbeeModel(e.target.value)}
                className="bg-bee-canvas/70 border border-bee-border rounded px-2 py-1 text-[10px] text-bee-text outline-none focus:ring-1 focus:ring-bee-gold transition-colors"
              >
                {availableModels.map((m) => (
                  <option key={`${m.providerId}-${m.model}`} value={m.model}>
                    {m.model} ({m.providerName})
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="text-[8px] text-bee-textMuted">
            Model: {queenbeeModel} — this powers QueenBee's own reasoning; WorkerBees use their own models
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.sender === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-xl px-3 py-2 text-xs ${
                msg.sender === "user"
                  ? "bg-bee-gold/15 text-bee-text border border-bee-gold/20"
                  : "glass text-bee-textDim"
              }`}
            >
              <div className="text-[10px] text-bee-textMuted mb-0.5 flex items-center gap-1">
                {msg.sender === "user" ? (
                  "You"
                ) : (
                  <span className="inline-flex items-center gap-1 text-bee-gold">
                    {(() => {
                      const Icon = MODE_ICONS[activeMode];
                      return <Icon size={11} />;
                    })()}
                    {activeMode}:
                  </span>
                )}
                <span className="ml-1.5 opacity-60">
                  {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              <div className="leading-relaxed">{msg.id === "welcome" ? welcomeText[activeMode] : msg.text}</div>
            </div>
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>

      <div className="p-2 border-t border-bee-border/50">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${activeMode}…`}
            className="flex-1 bg-bee-canvas/70 border border-bee-border rounded-lg px-3 py-1.5 text-xs text-bee-text placeholder-bee-textMuted outline-none focus:ring-1 focus:ring-bee-gold transition-colors"
          />
          {thinking ? (
            <div className="flex items-center justify-center p-1.5">
              <span className="w-3 h-3 rounded-full border-2 border-bee-gold border-t-transparent animate-spin" />
            </div>
          ) : (
            <button
              onClick={handleSend}
              disabled={!inputValue.trim()}
              className="flex items-center justify-center p-1.5 rounded-lg bg-bee-gold/10 border border-bee-gold/20 text-bee-goldHi hover:bg-bee-gold/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Send size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
