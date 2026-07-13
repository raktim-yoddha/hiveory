"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Settings, Pin, PinOff, ExternalLink } from "lucide-react";
import { useSettingsStore } from "@/stores/settingsStore";
import { useProviderStore } from "@/stores/providerStore";

interface Message {
  id: string;
  text: string;
  sender: "user" | "agent";
  timestamp: Date;
}

type AgentType = "QueenBee" | "Scout" | "Reviewer";

interface AgentDockProps {
  docked?: boolean;
  onToggleDock?: () => void;
}

export default function AgentDock({ docked, onToggleDock }: AgentDockProps) {
  const [activeAgent, setActiveAgent] = useState<AgentType>("QueenBee");
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      text: "Hello! I'm your QueenBee coordinator. Describe what you want to build and I'll plan the tasks.",
      sender: "agent",
      timestamp: new Date(),
    },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [showAgentMenu, setShowAgentMenu] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const apiKeys = useSettingsStore((s) => s.apiKeys);
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

  const callApi = async (message: string): Promise<string> => {
    const provider = findProviderForModel();
    const apiKey = provider?.apiKey || "";
    const providerId = provider?.id || "unknown";

    if (!apiKey) {
      return `[${activeAgent}] No API key configured for model "${queenbeeModel}". Connect a provider in Settings.`;
    }

    const history = messages
      .filter(m => m.id !== "welcome")
      .slice(-10)
      .map(m => ({ role: m.sender === "user" ? "user" : "assistant", content: m.text }));

    const systemPrompt = `You are QueenBee, a planning and coordination agent for the Hiveory system. Your job is to help the user plan software tasks, break down goals into actionable steps with file ownership declarations, and coordinate multiple AI coding agents. Keep responses concise and focused on the task.`;

    try {
      console.log(`[QueenBee] Calling provider=${providerId} model=${queenbeeModel}`);

      const isAnthropic = provider?.apiType === "anthropic-messages";
      const baseUrl = provider?.baseUrl?.replace(/\/+$/, "") || "";

      if (isAnthropic) {
        const resp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: queenbeeModel.replace("anthropic/", ""),
            system: systemPrompt,
            messages: [...history, { role: "user", content: message }],
            max_tokens: 1000,
          }),
        });
        const data = await resp.json();
        return data?.content?.[0]?.text || `[${activeAgent}] No response from model.`;
      }

      const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          ...(provider?.headers || {}),
        },
        body: JSON.stringify({
          model: queenbeeModel.includes("/") ? queenbeeModel.split("/").slice(1).join("/") : queenbeeModel,
          messages: [
            { role: "system", content: systemPrompt },
            ...history,
            { role: "user", content: message },
          ],
          max_tokens: 1000,
        }),
      });
      const data = await resp.json();
      console.log(`[QueenBee] Response received:`, data?.choices?.[0]?.message?.content?.slice(0, 80));
      return data?.choices?.[0]?.message?.content || `[${activeAgent}] No response from model.`;
    } catch (e: any) {
      console.error(`[QueenBee] API error:`, e);
      return `[${activeAgent}] Error: ${e?.message || "API call failed"}`;
    }
  };

  const handleSend = async () => {
    if (!inputValue.trim() || thinking) return;
    const userMsg: Message = {
      id: `msg-${Date.now()}`,
      text: inputValue.trim(),
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
    <div className="h-full glass-hi border-l border-bee-border/60 flex flex-col" style={{ width: "320px", minWidth: "320px" }}>
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-bee-border/50 relative">
        <div className="relative">
          <button
            onClick={() => setShowAgentMenu(!showAgentMenu)}
            className="flex items-center gap-1.5 text-xs font-semibold text-bee-gold hover:text-bee-goldHi transition-colors"
          >
            Agent
            <span className="text-[9px] opacity-70">▼</span>
          </button>
          {showAgentMenu && (
            <div className="absolute left-0 top-full mt-1 glass-hi rounded-lg z-50 min-w-32 p-1 animate-fade-in">
              {(["QueenBee", "Scout", "Reviewer"] as AgentType[]).map((agent) => (
                <button
                  key={agent}
                  onClick={() => { setActiveAgent(agent); setShowAgentMenu(false); }}
                  className={`w-full px-2.5 py-1.5 text-left text-xs rounded-md transition-colors ${
                    activeAgent === agent
                      ? "bg-bee-gold/10 text-bee-goldHi"
                      : "text-bee-textDim hover:text-bee-text hover:bg-bee-border/40"
                  }`}
                >
                  {agent}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-bee-textMuted font-mono">{activeAgent}</span>
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
                onClick={() => {}}
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
            Model: {queenbeeModel} — this powers QueenBee's own planning, not the agents it dispatches
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
              <div className="text-[10px] text-bee-textMuted mb-0.5">
                {msg.sender === "user" ? "You" : activeAgent}
                <span className="ml-1.5 opacity-60">
                  {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              <div className="leading-relaxed">{msg.text}</div>
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
            placeholder={`Message ${activeAgent}…`}
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
