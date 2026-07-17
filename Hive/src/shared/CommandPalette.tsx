"use client";

import { useState, useEffect, useRef } from "react";
import { Search, Terminal, File, Settings } from "lucide-react";

interface Command {
  id: string;
  label: string;
  icon: React.ReactNode;
  shortcut?: string;
  action: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onToggleterminal: () => void;
  onToggleSidebar: () => void;
  onOpenFile: () => void;
  onOpenSettings: () => void;
}

export default function CommandPalette({
  isOpen,
  onClose,
  onToggleterminal,
  onToggleSidebar,
  onOpenFile,
  onOpenSettings,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands: Command[] = [
    {
      id: "toggle-terminal",
      label: "Toggle terminal",
      icon: <Terminal size={16} />,
      shortcut: "Ctrl+`",
      action: () => {
        onToggleterminal();
        onClose();
      },
    },
    {
      id: "toggle-sidebar",
      label: "Toggle Sidebar",
      icon: <File size={16} />,
      shortcut: "Ctrl+B",
      action: () => {
        onToggleSidebar();
        onClose();
      },
    },
    {
      id: "open-file",
      label: "Open File",
      icon: <File size={16} />,
      shortcut: "Ctrl+O",
      action: () => {
        onOpenFile();
        onClose();
      },
    },
    {
      id: "open-settings",
      label: "Open Settings",
      icon: <Settings size={16} />,
      shortcut: "Ctrl+,",
      action: () => {
        onOpenSettings();
        onClose();
      },
    },
  ];

  const filteredCommands = commands.filter((cmd) =>
    cmd.label.toLowerCase().includes(query.toLowerCase()),
  );

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      setSelectedIndex(0);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % filteredCommands.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex(
          (prev) =>
            (prev - 1 + filteredCommands.length) % filteredCommands.length,
        );
      } else if (e.key === "Enter") {
        e.preventDefault();
        filteredCommands[selectedIndex]?.action();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, filteredCommands, selectedIndex, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-start justify-center pt-24 z-50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl glass-hi rounded-2xl overflow-hidden animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center px-4 py-3 border-b border-bee-border/50">
          <Search size={18} className="text-bee-gold mr-3" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command or search…"
            className="flex-1 bg-transparent text-bee-text placeholder-bee-textMuted outline-none text-sm"
          />
        </div>

        {/* Command list */}
        <div className="max-h-96 overflow-auto p-1.5">
          {filteredCommands.length === 0 ? (
            <div className="px-4 py-8 text-center text-bee-textMuted text-sm">
              No commands found
            </div>
          ) : (
            filteredCommands.map((cmd, index) => (
              <button
                key={cmd.id}
                onClick={cmd.action}
                className={`w-full flex items-center px-3 py-2 text-sm rounded-lg transition-colors ${
                  index === selectedIndex
                    ? "bg-bee-gold/15 text-bee-goldHi"
                    : "text-bee-textDim hover:bg-bee-border/40"
                }`}
              >
                <span className={`mr-3 ${index === selectedIndex ? "text-bee-gold" : "text-bee-textMuted"}`}>
                  {cmd.icon}
                </span>
                <span className="flex-1 text-left">{cmd.label}</span>
                {cmd.shortcut && (
                  <span className="text-[11px] text-bee-textMuted bg-bee-border/50 px-2 py-0.5 rounded-md">
                    {cmd.shortcut}
                  </span>
                )}
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-bee-border/50 text-[11px] text-bee-textMuted flex justify-between">
          <span>
            <span className="mr-4">↑↓ Navigate</span>
            <span className="mr-4">Enter Select</span>
            <span>Esc Close</span>
          </span>
        </div>
      </div>
    </div>
  );
}
