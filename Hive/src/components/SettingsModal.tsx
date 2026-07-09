"use client";

import { useState } from "react";
import { X, KeyRound, Eye, EyeOff } from "lucide-react";
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
    cli: "Claude Code, Aider",
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
    cli: "Gemini CLI",
    placeholder: "AIza...",
  },
];

export default function SettingsModal({ onClose }: SettingsModalProps) {
  const apiKeys = useSettingsStore((s) => s.apiKeys);
  const setApiKey = useSettingsStore((s) => s.setApiKey);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

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
