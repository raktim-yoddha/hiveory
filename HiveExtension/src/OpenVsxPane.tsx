"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RefreshCw, X, Maximize2, Minimize2, Blocks, KeyRound, Play } from "lucide-react";
import OpenVsxLogo from "./OpenVsxLogo";

/**
 * Open-VSX component for HoneyFlow: spawns a local `openvscode-server`
 * (Open-VSX marketplace by default) via a Tauri sidecar and embeds it in an
 * iframe, so real VS Code extensions run inside the board.
 *
 * The server binary is NOT bundled — point this at an installed
 * `openvscode-server` (Settings → binary path, or on PATH). The Rust side owns
 * the process lifecycle (start_openvsx / stop_openvsx).
 */
const BIN_KEY = "hive_openvsx_bin";
const ACCENT = "#a78bfa";

// ponytail: naive per-pane port from the id hash — fine for a handful of
// panes; add real free-port allocation if collisions show up.
function portForPane(paneId: string): number {
  let h = 0;
  for (let i = 0; i < paneId.length; i++) h = (h * 31 + paneId.charCodeAt(i)) & 0xffff;
  return 3200 + (h % 800);
}

interface Props {
  paneId: string;
  workingDir?: string | null;
  tabName?: string;
  /** Open-VSX extension id to install into this server before serving. */
  extensionId?: string;
  onClose: () => void;
  onToggleMaximize?: () => void;
  isMaximized?: boolean;
}

export default function OpenVsxPane({ paneId, workingDir, tabName = "HiveExtension", extensionId, onClose, onToggleMaximize, isMaximized }: Props) {
  const port = portForPane(paneId);
  const [status, setStatus] = useState<"idle" | "starting" | "running" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [bin, setBin] = useState<string>(() => localStorage.getItem(BIN_KEY) || "");
  const [configuring, setConfiguring] = useState(false);
  const [src, setSrc] = useState<string>("");

  const start = useCallback(async () => {
    setStatus("starting");
    setError(null);
    try {
      await invoke("start_openvsx", { paneId, bin: bin || null, port, extensions: extensionId ? [extensionId] : null });
      // poll readiness
      for (let i = 0; i < 60; i++) {
        const ready = await invoke<boolean>("openvsx_ready", { port }).catch(() => false);
        if (ready) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      const folder = workingDir ? `?folder=${encodeURIComponent(workingDir)}` : "";
      setSrc(`http://127.0.0.1:${port}/${folder}`);
      setStatus("running");
    } catch (e: any) {
      setError(String(e?.message || e));
      setStatus("error");
    }
  }, [paneId, bin, port, workingDir, extensionId]);

  // start on mount; stop on unmount
  const started = useRef(false);
  useEffect(() => {
    if (!started.current) { started.current = true; start(); }
    return () => { invoke("stop_openvsx", { paneId }).catch(() => {}); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveBin = () => { localStorage.setItem(BIN_KEY, bin); setConfiguring(false); start(); };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#1e1e1e]">
      {/* header (blade-purple), draggable like the other panes */}
      <div
        data-pane-drag
        className="flex h-8 shrink-0 items-center justify-between px-2 cursor-grab active:cursor-grabbing backdrop-blur-md border-b"
        style={{ borderColor: "rgba(167,139,250,0.34)", background: "linear-gradient(90deg, rgba(167,139,250,0.18), rgba(167,139,250,0.05))" }}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <OpenVsxLogo size={13} className="shrink-0" />
          <span className="truncate text-xs font-medium text-bee-text">{tabName}</span>
          <span className="text-[10px] text-bee-textMuted">:{port}</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setConfiguring(true)} className="rounded p-1 text-bee-textMuted hover:bg-black/30 hover:text-bee-text" title="Server binary">
            <KeyRound className="size-3.5" />
          </button>
          {onToggleMaximize && (
            <button onClick={onToggleMaximize} className="rounded p-1 text-bee-textMuted hover:bg-black/30 hover:text-bee-text" title={isMaximized ? "Restore" : "Maximize"}>
              {isMaximized ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
            </button>
          )}
          <button onClick={onClose} className="rounded p-1 text-bee-textMuted hover:bg-black/30 hover:text-bee-text" title="Close">
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden">
        {configuring ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <Blocks className="size-6" style={{ color: ACCENT }} />
            <div className="text-sm font-medium text-bee-text">openvscode-server binary</div>
            <p className="max-w-[38ch] text-[11px] leading-relaxed text-bee-textMuted">
              Path to the <code>openvscode-server</code> executable. Leave blank to use one on your PATH.
              Get it from github.com/gitpod-io/openvscode-server (Open-VSX marketplace by default).
            </p>
            <input
              value={bin}
              onChange={(e) => setBin(e.target.value)}
              placeholder="/path/to/openvscode-server"
              className="w-full max-w-sm rounded-md border border-bee-border/60 bg-bee-canvas/80 px-2.5 py-1.5 text-xs font-mono text-bee-text outline-none focus:border-[#a78bfa]/60"
            />
            <div className="flex gap-2">
              <button onClick={saveBin} className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-white" style={{ background: ACCENT }}>
                <Play className="size-3.5" /> Start
              </button>
              <button onClick={() => setConfiguring(false)} className="rounded-lg border border-bee-border/60 px-3 py-1.5 text-xs text-bee-textDim hover:text-bee-text">
                Cancel
              </button>
            </div>
          </div>
        ) : status === "running" && src ? (
          <iframe src={src} title={tabName} className="h-full w-full border-0" allow="clipboard-read; clipboard-write" />
        ) : status === "error" ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
            <p className="text-xs font-medium text-bee-err">Couldn't start openvscode-server</p>
            <p className="max-w-[34ch] text-[11px] text-bee-textMuted">{error}</p>
            <div className="mt-1 flex gap-2">
              <button onClick={start} className="flex items-center gap-1.5 rounded-md border px-3 py-1 text-xs" style={{ borderColor: `${ACCENT}55`, color: ACCENT }}>
                <RefreshCw className="size-3" /> Retry
              </button>
              <button onClick={() => setConfiguring(true)} className="rounded-md border border-bee-border/60 px-3 py-1 text-xs text-bee-textDim hover:text-bee-text">
                Set binary
              </button>
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-bee-textMuted">
            <RefreshCw className="size-5 animate-spin" style={{ color: ACCENT }} />
            <span className="text-xs">Starting openvscode-server…</span>
          </div>
        )}
      </div>
    </div>
  );
}
