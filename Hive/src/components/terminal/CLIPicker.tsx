'use client';

import { Bot } from 'lucide-react';

// v1 scope per AGENTS.md §5: Claude Code, Codex CLI, Aider, Gemini CLI only.
export type CLIType = 'claude-code' | 'codex-cli' | 'aider' | 'gemini-cli';

export interface CLIInfo {
  id: CLIType;
  name: string;
  description: string;
}

// The actual executable invoked in the pty — must match a binary the user has
// installed and on PATH (e.g. `npm i -g @anthropic-ai/claude-code`).
export const CLI_COMMANDS: Record<CLIType, string> = {
  'claude-code': 'claude',
  'codex-cli': 'codex',
  aider: 'aider',
  'gemini-cli': 'gemini',
};

const CLI_OPTIONS: CLIInfo[] = [
  { id: 'claude-code', name: 'Claude Code', description: 'Anthropic Claude CLI · claude' },
  { id: 'codex-cli', name: 'Codex CLI', description: 'OpenAI Codex CLI · codex' },
  { id: 'aider', name: 'Aider', description: 'AI pair programming tool · aider' },
  { id: 'gemini-cli', name: 'Gemini CLI', description: 'Google Gemini CLI · gemini' },
];

interface CLIPickerProps {
  onSelect: (cli: CLIType) => void;
  onClose: () => void;
  position?: { x: number; y: number };
}

export default function CLIPicker({ onSelect, onClose, position }: CLIPickerProps) {
  // Calculate safe position to keep dropdown within viewport
  const getSafePosition = () => {
    if (!position) return undefined;

    const dropdownWidth = 320; // w-80 = 20rem = 320px
    const dropdownHeight = 260;
    const padding = 8;

    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;

    let safeX = position.x;
    let safeY = position.y;

    // Prevent horizontal overflow
    if (safeX + dropdownWidth > windowWidth - padding) {
      safeX = windowWidth - dropdownWidth - padding;
    }
    if (safeX < padding) {
      safeX = padding;
    }

    // Prevent vertical overflow - show above if not enough space below
    if (safeY + dropdownHeight > windowHeight - padding) {
      safeY = position.y - dropdownHeight - padding;
      if (safeY < padding) {
        safeY = padding;
      }
    }

    return { left: safeX, top: safeY };
  };
  return (
    <div
      className="fixed glass-hi rounded-xl z-50 w-80 max-h-96 overflow-hidden animate-scale-in"
      style={getSafePosition()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-3 py-2.5 border-b border-bee-border/50">
        <div className="flex items-center gap-2">
          <Bot size={14} className="text-bee-gold" />
          <span className="text-sm font-semibold text-bee-text">Select CLI Agent</span>
        </div>
      </div>
      <div className="overflow-y-auto max-h-80 p-1">
        {CLI_OPTIONS.map((cli) => (
          <button
            key={cli.id}
            onClick={() => {
              onSelect(cli.id);
              onClose();
            }}
            className="group w-full px-2.5 py-2 text-left rounded-lg hover:bg-bee-gold/12 transition-colors"
          >
            <div className="flex items-start gap-2.5">
              <span className="mt-1 w-1.5 h-1.5 rounded-full bg-bee-gold/50 group-hover:bg-bee-gold group-hover:shadow-glow flex-shrink-0 transition-all" />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-bee-text font-medium group-hover:text-bee-goldHi transition-colors">
                  {cli.name}
                </div>
                <div className="text-xs text-bee-textMuted mt-0.5">{cli.description}</div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
