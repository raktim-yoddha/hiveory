"use client";

import { useState, useEffect, useRef } from "react";
import { Search, terminal, File, Settings, GitBranch } from "lucide-react";

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
      icon: <terminal size={16} />,
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
      className="fixed inset-0 bg-black/50 flex items-start justify-center pt-24 z-50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-[#252526] border border-[#3c3c3c] rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center px-4 py-3 border-b border-[#3c3c3c]">
          <Search size={18} className="text-gray-400 mr-3" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command or search..."
            className="flex-1 bg-transparent text-white placeholder-gray-500 outline-none text-sm"
          />
        </div>

        {/* Command list */}
        <div className="max-h-96 overflow-auto py-2">
          {filteredCommands.length === 0 ? (
            <div className="px-4 py-8 text-center text-gray-500 text-sm">
              No commands found
            </div>
          ) : (
            filteredCommands.map((cmd, index) => (
              <button
                key={cmd.id}
                onClick={cmd.action}
                className={`w-full flex items-center px-4 py-2 text-sm hover:bg-[#2a2d2e] transition-colors ${
                  index === selectedIndex ? "bg-[#2a2d2e]" : ""
                }`}
              >
                <span className="mr-3 text-gray-400">{cmd.icon}</span>
                <span className="flex-1 text-left text-gray-300">
                  {cmd.label}
                </span>
                {cmd.shortcut && (
                  <span className="text-xs text-gray-500 bg-[#3c3c3c] px-2 py-0.5 rounded">
                    {cmd.shortcut}
                  </span>
                )}
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-[#3c3c3c] text-xs text-gray-500 flex justify-between">
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
