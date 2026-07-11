"use client";

import { useState } from "react";
import { X, KeyRound, Eye, EyeOff, Terminal, Sliders } from "lucide-react";
import { useSettingsStore, ApiKeys } from "@/stores/settingsStore";

interface SettingsModalProps {
  onClose: () => void;
}

const FIELDS: {
  key: keyof ApiKeys;
  label: string;
  cli: string;
  placeholder: string;
}[] = [
  {
    key: "anthropic",
    label: "Anthropic API Key",
    cli: "Claude Code, Aider, Cline",
    placeholder: "sk-ant-...",
  },
  {
    key: "openai",
    label: "OpenAI API Key",
    cli: "Codex CLI, Aider",
    placeholder: "sk-...",
  },
  {
    key: "google",
    label: "Google API Key",
    cli: "Antigravity CLI",
    placeholder: "AIza...",
  },
  {
    key: "openrouter",
    label: "OpenRouter API Key",
    cli: "OpenCode, Cline",
    placeholder: "sk-or-...",
  },
  {
    key: "moonshot",
    label: "Moonshot API Key",
    cli: "Kimi Code",
    placeholder: "sk-...",
  },
];

export default function SettingsModal({ onClose }: SettingsModalProps) {
  const apiKeys = useSettingsStore((s) => s.apiKeys);
  const setApiKey = useSettingsStore((s) => s.setApiKey);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const defaultWorkerBee = useSettingsStore((s) => s.defaultWorkerBee);
  const setDefaultWorkerBee = useSettingsStore((s) => s.setDefaultWorkerBee);
  const nectarTokenBudget = useSettingsStore((s) => s.nectarTokenBudget);
  const setNectarTokenBudget = useSettingsStore((s) => s.setNectarTokenBudget);

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-start justify-center pt-24 z-[100]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md glass-hi rounded-2xl overflow-hidden animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-bee-border/50">
          <div className="flex items-center gap-2">
            <KeyRound size={16} className="text-bee-gold" />
            <span className="text-sm font-semibold text-bee-text">
              CLI Agent API Keys
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-bee-border/60 text-bee-textMuted hover:text-bee-text transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4 flex flex-col gap-4">
          <p className="text-xs text-bee-textMuted leading-relaxed">
            Keys are stored locally on this device and passed as environment
            variables only to the CLI process you launch — never sent
            anywhere else.
          </p>

          {FIELDS.map((field) => (
            <div key={field.key} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-bee-textDim">
                  {field.label}
                </label>
                <span className="text-[10px] text-bee-textMuted">
                  {field.cli}
                </span>
              </div>
              <div className="relative">
                <input
                  type={revealed[field.key] ? "text" : "password"}
                  value={apiKeys[field.key]}
                  onChange={(e) => setApiKey(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  className="w-full bg-bee-canvas/70 border border-bee-border rounded-lg px-3 py-2 pr-9 text-sm text-bee-text placeholder-bee-textMuted outline-none focus:ring-1 focus:ring-bee-gold transition-colors font-mono"
                  spellCheck={false}
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() =>
                    setRevealed((r) => ({ ...r, [field.key]: !r[field.key] }))
                  }
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-bee-textMuted hover:text-bee-text transition-colors"
                  title={revealed[field.key] ? "Hide" : "Show"}
                >
                  {revealed[field.key] ? (
                    <EyeOff size={14} />
                  ) : (
                    <Eye size={14} />
                  )}
                </button>
              </div>
            </div>
          ))}

          <div className="border-t border-bee-border/50 pt-4 flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <Terminal size={16} className="text-bee-gold" />
              <span className="text-sm font-semibold text-bee-text">
                WorkerBee Settings
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-bee-textDim">
                Default CLI Agent
              </label>
              <select
                value={defaultWorkerBee}
                onChange={(e) => setDefaultWorkerBee(e.target.value)}
                className="w-full bg-bee-canvas/70 border border-bee-border rounded-lg px-3 py-2 text-sm text-bee-text outline-none focus:ring-1 focus:ring-bee-gold transition-colors"
              >
                <option value="claude">Claude Code</option>
                <option value="codex">Codex CLI</option>
                <option value="aider">Aider</option>
                <option value="agy">Antigravity CLI</option>
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-bee-textDim">
                Nectar Token Budget
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={nectarTokenBudget}
                  onChange={(e) => setNectarTokenBudget(parseInt(e.target.value) || 4000)}
                  min="1000"
                  max="16000"
                  step="500"
                  className="flex-1 bg-bee-canvas/70 border border-bee-border rounded-lg px-3 py-2 text-sm text-bee-text outline-none focus:ring-1 focus:ring-bee-gold transition-colors font-mono"
                />
                <span className="text-xs text-bee-textMuted">tokens</span>
              </div>
              <p className="text-[10px] text-bee-textMuted">
                Maximum tokens of project context to inject into CLI sessions
              </p>
            </div>
          </div>
        </div>

        <div className="px-4 py-3 border-t border-bee-border/50 flex justify-end">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs bg-bee-gold/10 border border-bee-gold/20 text-bee-goldHi hover:bg-bee-gold/20 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
