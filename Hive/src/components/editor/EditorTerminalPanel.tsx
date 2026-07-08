"use client";

import { useState } from "react";
import { Terminal, X } from "lucide-react";
import TerminalPane from "../terminal/TerminalPane";

interface EditorTerminalPanelProps {
  workingDir?: string | null;
  height?: number;
}

export default function EditorTerminalPanel({ workingDir, height = 256 }: EditorTerminalPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <div className="h-8 bg-[#241f1c] border-t border-[#3d2e1f] flex items-center justify-between px-3">
        <button
          onClick={() => setCollapsed(false)}
          className="flex items-center gap-2 text-xs text-[#c9b896] hover:text-[#f5f0e6]"
        >
          <Terminal size={14} />
          <span>Terminal</span>
        </button>
      </div>
    );
  }

  return (
    <div
      className="bg-[#1a1614] flex flex-col border-t border-[#3d2e1f]"
      style={{ height: `${height}px` }}
    >
      {/* terminal toolbar - single inline terminal, no tab counting */}
      <div className="h-8 bg-[#241f1c] flex items-center justify-between px-3">
        <div className="flex items-center gap-2 text-xs text-[#c9b896]">
          <Terminal size={14} className="text-[#c9a227]" />
          <span>Terminal</span>
        </div>

        <button
          onClick={() => setCollapsed(true)}
          className="p-1 rounded hover:bg-[#3d2e1f] text-[#8a7b5c] hover:text-[#c9b896] transition-colors"
          title="Collapse terminal"
        >
          <X size={14} />
        </button>
      </div>

      {/* Single terminal */}
      <div className="flex-1 overflow-hidden min-h-0">
        <TerminalPane paneId="editor-terminal" workingDir={workingDir} tabName="Terminal" />
      </div>
    </div>
  );
}
