"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Settings, Pin, PinOff, ExternalLink, ClipboardList, Search, Zap, ChevronDown, type LucideIcon } from "lucide-react";
import { MODE_SYSTEM_PROMPTS, detectModeIntent, type QueenBeeMode } from "@hiveory/queenbee";
import type { ColumnId } from "@hiveory/taskcomb";
import { useSettingsStore } from "@/stores/settingsStore";
import { useProviderStore } from "@/stores/providerStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useWorkerBeesStore } from "@/stores/workerBeesStore";
import {
  toAnthropicTools,
  toOpenAITools,
  executeTool,
  ToolError,
  ASYNC_TOOLS,
  type ToolContext,
} from "@/lib/queenbeeTools";
import { useProjectStore } from "@/stores/projectStore";
import { dispatchGoal } from "@/lib/dispatch";

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
  Stinger: Zap,
};

interface QueenBeeChatProps {
  docked?: boolean;
  onToggleDock?: () => void;
  onOpenSettings?: () => void;
}

export default function QueenBeeChat({ docked, onToggleDock, onOpenSettings }: QueenBeeChatProps) {
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
          paneLayout: [], taskCards: [], nextSortOrder: 0,
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
      setBoardOpen: (open) => useWorkspaceStore.getState().setBoardOpen(open),
    };
  };

  const runTool = async (name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<string> => {
    try {
      if (ASYNC_TOOLS.has(name)) {
        if (activeMode !== "Steward") throw new ToolError(`Tool "${name}" is not available in ${activeMode} mode.`);
        if (name === "dispatch_goal") {
          const goal = String(args.goal || "");
          if (!goal) throw new ToolError('Missing required argument "goal" for dispatch_goal.');
          const projectPath = useProjectStore.getState().projectPath || "";
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
          const ok = results.filter((r) => !r.error);
          const failed = results.filter((r) => r.error);
          const lines = results.map((r) =>
            r.error ? `- ✗ ${r.title}: ${r.error}` : `- ✓ ${r.title} (${r.cli})${r.worktree ? ` @ ${r.worktree.branch}` : ""}`,
          );
          return `Dispatched ${ok.length}/${results.length} task(s)${failed.length ? `, ${failed.length} failed` : ""}:\n${lines.join("\n")}`;
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
            toolUses.map(async (tu) => ({
              type: "tool_result",
              tool_use_id: tu.id,
              content: await runTool(tu.name, tu.input || {}, ctx),
            })),
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
        for (const tc of toolCalls) {
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(tc.function?.arguments || "{}"); } catch { /* leave empty; runTool reports missing args */ }
          msgs.push({
            role: "tool",
            tool_call_id: tc.id,
            content: await runTool(tc.function?.name, args, ctx),
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
              {(["Steward", "Forager", "Stinger"] as QueenBeeMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => handleModeSwitch(mode)}
                  className={`w-full px-2.5 py-1.5 text-left text-xs rounded-md transition-colors ${
                    activeMode === mode
                      ? "bg-bee-gold/10 text-bee-goldHi"
                      : "text-bee-textDim hover:text-bee-text hover:bg-bee-border/40"
                  }`}
                >
                  {mode}
                </button>
              ))}
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
