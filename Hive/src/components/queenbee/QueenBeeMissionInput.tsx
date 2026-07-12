"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";

interface QueenBeeMissionInputProps {
  projectPath?: string;
}

export default function QueenBeeMissionInput({ projectPath }: QueenBeeMissionInputProps) {
  const [goal, setGoal] = useState("");
  const [planning, setPlanning] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);

  const handlePlan = async () => {
    if (!goal.trim() || planning) return;
    setPlanning(true);
    setStatusText("Analyzing project structure…");
    console.log("[QueenBee] Planning mission:", goal.trim());
    await new Promise((r) => setTimeout(r, 1500));
    console.log("[QueenBee] Breakdown complete for:", goal.trim());
    setStatusText(null);
    setPlanning(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handlePlan();
    }
  };

  return (
    <div className="glass-toolbar border-b border-bee-border/50 px-3 py-2 flex-shrink-0">
      <div className="flex items-center gap-2 max-w-2xl mx-auto">
        <div className="flex-1 relative">
          <input
            type="text"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe what you want to build…"
            className="w-full bg-bee-canvas/70 border border-bee-border rounded-lg px-3 py-1.5 pr-8 text-xs text-bee-text placeholder-bee-textMuted outline-none focus:ring-1 focus:ring-bee-gold transition-colors"
            disabled={planning}
          />
          {goal.length > 0 && !planning && (
            <button
              onClick={() => setGoal("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-bee-textMuted hover:text-bee-text transition-colors"
            >
              <span className="text-[10px] font-mono">✕</span>
            </button>
          )}
        </div>
        <button
          onClick={handlePlan}
          disabled={!goal.trim() || planning}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-bee-gold/10 border border-bee-gold/20 text-bee-goldHi hover:bg-bee-gold/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {planning ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Sparkles size={12} />
          )}
          Plan
        </button>
      </div>
      {statusText && (
        <div className="max-w-2xl mx-auto mt-1.5">
          <span className="text-[10px] text-bee-textMuted flex items-center gap-1.5">
            <Loader2 size={10} className="animate-spin text-bee-gold" />
            {statusText}
          </span>
        </div>
      )}
    </div>
  );
}
