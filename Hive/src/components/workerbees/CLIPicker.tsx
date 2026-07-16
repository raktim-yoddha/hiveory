'use client';

import { Bot } from 'lucide-react';
import { CLI_METADATA } from '@hiveory/worker-bees';
import type { CLISlug } from '@hiveory/worker-bees';

export type CLIType = CLISlug;

interface CLIPickerProps {
  onSelect: (cli: CLIType) => void;
  onClose: () => void;
  position?: { x: number; y: number };
}

const CLI_OPTIONS = CLI_METADATA.map((c) => ({
  id: c.id as CLIType,
  name: c.name,
  description: `${c.description} · ${c.command}`,
}));

export default function CLIPicker({ onSelect, onClose, position }: CLIPickerProps) {
  const getSafePosition = () => {
    if (!position) return undefined;

    const dropdownWidth = 320;
    const dropdownHeight = 260;
    const padding = 8;

    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;

    let safeX = position.x;
    let safeY = position.y;

    if (safeX + dropdownWidth > windowWidth - padding) {
      safeX = windowWidth - dropdownWidth - padding;
    }
    if (safeX < padding) {
      safeX = padding;
    }

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
