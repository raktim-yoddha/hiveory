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
      <div className="h-8 glass-toolbar border-t border-bee-border/60 flex items-center justify-between px-3">
        <button
          onClick={() => setCollapsed(false)}
          className="flex items-center gap-2 text-xs text-bee-textDim hover:text-bee-text transition-colors"
        >
          <Terminal size={14} className="text-bee-gold" />
          <span>Terminal</span>
        </button>
      </div>
    );
  }

  return (
    <div
      className="glass-toolbar flex flex-col border-t border-bee-border/60"
      style={{ height: `${height}px` }}
    >
      {/* terminal toolbar - single inline terminal, no tab counting */}
      <div className="h-8 flex items-center justify-between px-3 border-b border-bee-border/40">
        <div className="flex items-center gap-2 text-xs text-bee-textDim">
          <Terminal size={14} className="text-bee-gold" />
          <span className="font-medium">Terminal</span>
        </div>

        <button
          onClick={() => setCollapsed(true)}
          className="p-1 rounded-md hover:bg-bee-border/60 text-bee-textMuted hover:text-bee-textDim transition-colors"
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
