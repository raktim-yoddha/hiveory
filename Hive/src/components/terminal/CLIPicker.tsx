'use client';

import { Bot } from 'lucide-react';

export type CLIType = 'claude-code' | 'codex-cli' | 'aider' | 'gemini-cli' | 'antigravity' | 'open-code' | 'kimi-code' | 'cline' | 'cursor' | 'windsurf';

export interface CLIInfo {
  id: CLIType;
  name: string;
  description: string;
}

const CLI_OPTIONS: CLIInfo[] = [
  { id: 'claude-code', name: 'Claude Code', description: 'Anthropic Claude CLI' },
  { id: 'codex-cli', name: 'Codex CLI', description: 'OpenAI Codex CLI' },
  { id: 'aider', name: 'Aider', description: 'AI pair programming tool' },
  { id: 'gemini-cli', name: 'Gemini CLI', description: 'Google Gemini CLI' },
  { id: 'antigravity', name: 'Antigravity', description: 'Antigravity AI CLI' },
  { id: 'open-code', name: 'OpenCode', description: 'OpenCode AI assistant' },
  { id: 'kimi-code', name: 'Kimi Code', description: 'Moonshot AI CLI' },
  { id: 'cline', name: 'Cline', description: 'Cline AI assistant' },
  { id: 'cursor', name: 'Cursor', description: 'Cursor AI CLI' },
  { id: 'windsurf', name: 'Windsurf', description: 'Windsurf AI CLI' },
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
    const dropdownHeight = 384; // max-h-96 = 24rem = 384px
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
      className="fixed bg-[#241f1c] border border-[#3d2e1f] rounded shadow-2xl z-50 w-80 max-h-96 overflow-hidden"
      style={getSafePosition()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-3 py-2 border-b border-[#3d2e1f]">
        <div className="flex items-center gap-2">
          <Bot size={14} className="text-[#c9a227]" />
          <span className="text-sm font-medium text-[#f5f0e6]">Select CLI Agent</span>
        </div>
      </div>
      <div className="overflow-y-auto max-h-80">
        {CLI_OPTIONS.map((cli) => (
          <button
            key={cli.id}
            onClick={() => {
              onSelect(cli.id);
              onClose();
            }}
            className="w-full px-3 py-2 text-left hover:bg-[#3d2e1f] transition-colors border-b border-[#3d2e1f]/30 last:border-0"
          >
            <div className="flex items-start gap-2">
              <Bot size={12} className="text-[#8a7b5c] mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-[#f5f0e6] font-medium">{cli.name}</div>
                <div className="text-xs text-[#8a7b5c] mt-0.5">{cli.description}</div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
