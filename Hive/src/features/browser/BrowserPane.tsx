"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  ArrowLeft, ArrowRight, RotateCw, Camera, X, Maximize2, Minimize2, Globe,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { CdpClient, normalizeUrl } from "@/features/browser/cdp";
import { useBrowserStore } from "@/features/browser/browserStore";

const CDP_PORT = 9222;

/** CDP modifier bitmask: Alt=1, Ctrl=2, Meta=4, Shift=8. */
function cdpModifiers(e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): number {
  return (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);
}

interface Props {
  paneId: string;
  initialUrl?: string;
  onClose: () => void;
  onToggleMaximize: () => void;
  isMaximized: boolean;
}

export default function BrowserPane({
  paneId, initialUrl = "about:blank", onClose, onToggleMaximize, isMaximized,
}: Props) {
  const [urlInput, setUrlInput] = useState(initialUrl === "about:blank" ? "" : initialUrl);
  const [frame, setFrame] = useState<string | null>(null);
  const [status, setStatus] = useState<"booting" | "ready" | "error">("booting");
  const [error, setError] = useState<string | null>(null);
  const [shotFlash, setShotFlash] = useState(false);
  // Bumped by Retry to re-run the boot effect.
  const [bootNonce, setBootNonce] = useState(0);

  const clientRef = useRef<CdpClient | null>(null);
  const sessionRef = useRef<string | null>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  // Mirrors urlInput so callbacks registered once don't read a stale URL.
  const urlRef = useRef(initialUrl);
  useEffect(() => { urlRef.current = urlInput; }, [urlInput]);

  const setScreenshot = useBrowserStore((s) => s.setScreenshot);
  const clearScreenshot = useBrowserStore((s) => s.clearScreenshot);
  const registerControls = useBrowserStore((s) => s.registerControls);
  const unregisterControls = useBrowserStore((s) => s.unregisterControls);

  /* ── Boot: launch Chromium, attach a target, start the screencast ── */
  useEffect(() => {
    let cancelled = false;
    let client: CdpClient | null = null;

    (async () => {
      try {
        await invoke<number>("launch_cdp_browser", { port: CDP_PORT });
        // Resolved in Rust: the DevTools HTTP endpoint has no CORS headers, so
        // the renderer can't fetch it directly. Rust also waits out the boot.
        const wsUrl = await invoke<string>("cdp_ws_url", { port: CDP_PORT });
        if (cancelled) return;

        client = await CdpClient.connect(wsUrl);
        if (cancelled) { client.close(); return; }
        clientRef.current = client;

        const { targetId } = await client.send<{ targetId: string }>("Target.createTarget", {
          url: initialUrl,
        });
        const { sessionId } = await client.send<{ sessionId: string }>("Target.attachToTarget", {
          targetId,
          flatten: true,
        });
        if (cancelled) return;
        sessionRef.current = sessionId;

        await client.send("Page.enable", {}, sessionId);

        // Frames arrive as base64 JPEG; each must be acked or the stream stalls.
        client.on("Page.screencastFrame", (p: any) => {
          setFrame(p.data);
          client!.send("Page.screencastFrameAck", { sessionId: p.sessionId }, sessionId).catch(() => {});
        });
        client.on("Page.frameNavigated", (p: any) => {
          if (p.frame?.parentId) return; // only the main frame
          if (p.frame?.url && p.frame.url !== "about:blank") setUrlInput(p.frame.url);
        });

        const rect = viewRef.current?.getBoundingClientRect();
        await client.send("Emulation.setDeviceMetricsOverride", {
          width: Math.max(320, Math.round(rect?.width ?? 1280)),
          height: Math.max(240, Math.round(rect?.height ?? 800)),
          deviceScaleFactor: 1,
          mobile: false,
        }, sessionId);

        await client.send("Page.startScreencast", {
          format: "jpeg", quality: 65, everyNthFrame: 1,
        }, sessionId);

        if (!cancelled) setStatus("ready");
      } catch (e: any) {
        if (!cancelled) {
          setError(String(e?.message ?? e));
          setStatus("error");
        }
      }
    })();

    return () => {
      cancelled = true;
      const s = sessionRef.current;
      const c = clientRef.current;
      if (c && s) c.send("Page.stopScreencast", {}, s).catch(() => {});
      c?.close();
      clientRef.current = null;
      clearScreenshot(paneId);
    };
  }, [paneId, initialUrl, clearScreenshot, bootNonce]);

  /* ── Keep the emulated viewport matched to the pane size ────────── */
  useEffect(() => {
    if (status !== "ready" || !viewRef.current) return;
    const el = viewRef.current;
    const ro = new ResizeObserver(() => {
      const c = clientRef.current, s = sessionRef.current;
      if (!c || !s) return;
      const r = el.getBoundingClientRect();
      c.send("Emulation.setDeviceMetricsOverride", {
        width: Math.max(320, Math.round(r.width)),
        height: Math.max(240, Math.round(r.height)),
        deviceScaleFactor: 1,
        mobile: false,
      }, s).catch(() => {});
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [status]);

  const cmd = useCallback(async (method: string, params: object = {}) => {
    const c = clientRef.current, s = sessionRef.current;
    if (!c || !s) return;
    try { await c.send(method, params, s); } catch (e: any) { setError(String(e?.message ?? e)); }
  }, []);

  const navigate = useCallback((raw: string) => {
    let url: string;
    try {
      url = normalizeUrl(raw);
    } catch (e: any) {
      setError(String(e?.message ?? e));
      return;
    }
    setError(null);
    setUrlInput(url === "about:blank" ? "" : url);
    cmd("Page.navigate", { url });
  }, [cmd]);

  /* ── Input forwarding ─────────────────────────────────────────────
     The frame is an <img> with object-contain, so it can be letterboxed inside
     the pane. Mapping by the element rect alone would offset every click; scale
     from the *rendered* image box instead. */
  const toPageCoords = (e: { clientX: number; clientY: number }, img: HTMLImageElement) => {
    const r = img.getBoundingClientRect();
    const nw = img.naturalWidth, nh = img.naturalHeight;
    if (!r.width || !r.height || !nw || !nh) return null;
    const scale = Math.min(r.width / nw, r.height / nh);
    const offX = r.left + (r.width - nw * scale) / 2;
    const offY = r.top + (r.height - nh * scale) / 2;
    return {
      x: Math.round((e.clientX - offX) / scale),
      y: Math.round((e.clientY - offY) / scale),
    };
  };

  const dispatchMouse = (e: React.MouseEvent<HTMLImageElement>, type: string) => {
    const p = toPageCoords(e, e.currentTarget);
    if (!p) return;
    cmd("Input.dispatchMouseEvent", {
      type, x: p.x, y: p.y,
      button: "left",
      modifiers: cdpModifiers(e),
      clickCount: type === "mousePressed" || type === "mouseReleased" ? 1 : 0,
    });
  };

  // mousemove fires per pixel; one CDP round-trip each would flood the socket.
  const moveQueued = useRef(false);
  const dispatchMouseMove = (e: React.MouseEvent<HTMLImageElement>) => {
    if (moveQueued.current) return;
    moveQueued.current = true;
    const img = e.currentTarget;
    const { clientX, clientY } = e;
    requestAnimationFrame(() => {
      moveQueued.current = false;
      const p = toPageCoords({ clientX, clientY }, img);
      if (!p) return;
      cmd("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y, button: "none" });
    });
  };

  /** Forward a real key press to the page (typing, Enter, Backspace, shortcuts). */
  const dispatchKey = (e: React.KeyboardEvent, type: "keyDown" | "keyUp") => {
    // Printable keys must carry `text`, or the page receives the keypress but
    // never inserts the character.
    const printable = e.key.length === 1;
    const text = printable ? e.key : e.key === "Enter" ? "\r" : e.key === "Tab" ? "\t" : "";
    cmd("Input.dispatchKeyEvent", {
      type: type === "keyDown" && !text ? "rawKeyDown" : type,
      modifiers: cdpModifiers(e),
      key: e.key,
      code: e.code,
      windowsVirtualKeyCode: e.keyCode,
      nativeVirtualKeyCode: e.keyCode,
      ...(type === "keyDown" && text ? { text, unmodifiedText: text.toLowerCase() } : {}),
    });
  };

  const screenshot = useCallback(async () => {
    const c = clientRef.current, s = sessionRef.current;
    if (!c || !s) return null;
    try {
      const { data } = await c.send<{ data: string }>("Page.captureScreenshot", { format: "png" }, s);
      const shot = { data, url: urlRef.current || "about:blank", takenAt: Date.now() };
      // Park it in the store so QueenBee/WorkerBees can attach it to a message.
      setScreenshot(paneId, shot);
      setShotFlash(true);
      setTimeout(() => setShotFlash(false), 350);
      return shot;
    } catch (e: any) {
      setError(String(e?.message ?? e));
      return null;
    }
  }, [paneId, setScreenshot]);

  /* ── Expose controls so QueenBee's capture tool can drive this pane ── */
  useEffect(() => {
    if (status !== "ready") return;
    registerControls(paneId, { capture: screenshot, navigate });
    return () => unregisterControls(paneId);
  }, [status, paneId, screenshot, navigate, registerControls, unregisterControls]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bee-canvas">
      {/* Toolbar — data-pane-drag keeps it swappable like the other panes */}
      <div
        data-pane-drag
        className="flex h-8 shrink-0 cursor-grab items-center gap-1 border-b border-bee-border/50 glass-toolbar px-1.5 active:cursor-grabbing"
      >
        <Globe className="size-3 shrink-0 text-bee-gold" />
        <button
          onClick={() => cmd("Runtime.evaluate", { expression: "history.back()" })}
          className="rounded p-0.5 text-bee-textMuted transition-colors hover:bg-bee-border/50 hover:text-bee-text"
          title="Back"
        >
          <ArrowLeft className="size-3" />
        </button>
        <button
          onClick={() => cmd("Runtime.evaluate", { expression: "history.forward()" })}
          className="rounded p-0.5 text-bee-textMuted transition-colors hover:bg-bee-border/50 hover:text-bee-text"
          title="Forward"
        >
          <ArrowRight className="size-3" />
        </button>
        <button
          onClick={() => cmd("Page.reload", {})}
          className="rounded p-0.5 text-bee-textMuted transition-colors hover:bg-bee-border/50 hover:text-bee-text"
          title="Reload"
        >
          <RotateCw className="size-3" />
        </button>

        <input
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") navigate(urlInput); }}
          placeholder="3000 · localhost:5173 · /dashboard"
          spellCheck={false}
          className="mx-1 min-w-0 flex-1 rounded-md border border-bee-border/50 bg-bee-canvas/60 px-2 py-0.5 text-[11px] text-bee-text outline-none transition-colors placeholder:text-bee-textMuted/50 focus:border-bee-gold/40"
        />

        <button
          onClick={screenshot}
          disabled={status !== "ready"}
          className="rounded p-0.5 text-bee-textMuted transition-colors hover:bg-bee-gold/20 hover:text-bee-gold disabled:opacity-30"
          title="Capture screenshot for QueenBee"
        >
          <Camera className="size-3" />
        </button>
        <button
          onClick={onToggleMaximize}
          className="rounded p-0.5 text-bee-textMuted transition-colors hover:bg-bee-border/50 hover:text-bee-text"
          title={isMaximized ? "Restore" : "Maximize"}
        >
          {isMaximized ? <Minimize2 className="size-3" /> : <Maximize2 className="size-3" />}
        </button>
        <button
          onClick={onClose}
          className="rounded p-0.5 text-bee-textMuted transition-colors hover:bg-bee-err/70 hover:text-white"
          title="Close"
        >
          <X className="size-3" />
        </button>
      </div>

      {/* Viewport */}
      <div ref={viewRef} className="relative min-h-0 flex-1 overflow-hidden">
        {status === "booting" && (
          <div className="flex h-full items-center justify-center text-[11px] text-bee-textMuted">
            Starting browser…
          </div>
        )}
        {status === "error" && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <Globe className="mb-1 size-5 text-bee-textMuted/50" />
            <p className="text-[11px] font-medium text-bee-err">Preview engine didn't start</p>
            <p className="max-w-[380px] text-[10px] leading-[1.5] text-bee-textMuted">{error}</p>
            <p className="max-w-[380px] text-[10px] leading-[1.5] text-bee-textMuted/70">
              This pane previews your local dev server. It needs Microsoft Edge or
              Google Chrome installed to render the page.
            </p>
            <button
              onClick={() => { setStatus("booting"); setError(null); setBootNonce((n) => n + 1); }}
              className="mt-1 rounded-md border border-bee-gold/30 bg-bee-gold/10 px-2.5 py-1 text-[10px] font-medium text-bee-goldHi transition-colors hover:bg-bee-gold/20"
            >
              Retry
            </button>
          </div>
        )}
        {status === "ready" && frame && (
          <img
            ref={imgRef}
            src={`data:image/jpeg;base64,${frame}`}
            alt=""
            draggable={false}
            // tabIndex makes the frame focusable so the page can receive keys.
            tabIndex={0}
            onMouseDown={(e) => { e.currentTarget.focus(); dispatchMouse(e, "mousePressed"); }}
            onMouseUp={(e) => dispatchMouse(e, "mouseReleased")}
            onMouseMove={dispatchMouseMove}
            onKeyDown={(e) => {
              // Let the pane keep browser-level shortcuts; forward the rest.
              if (e.key === "F5" || (e.ctrlKey && e.key.toLowerCase() === "r")) return;
              e.preventDefault();
              dispatchKey(e, "keyDown");
            }}
            onKeyUp={(e) => { e.preventDefault(); dispatchKey(e, "keyUp"); }}
            onWheel={(e) => {
              // Wheel must land under the cursor, not at the origin.
              const p = toPageCoords(e, e.currentTarget);
              if (!p) return;
              cmd("Input.dispatchMouseEvent", {
                type: "mouseWheel", x: p.x, y: p.y,
                deltaX: -e.deltaX, deltaY: -e.deltaY,
                modifiers: cdpModifiers(e),
              });
            }}
            className="h-full w-full select-none object-contain outline-none"
          />
        )}
        {status === "ready" && !frame && (
          <div className="flex h-full items-center justify-center text-[11px] text-bee-textMuted">
            Enter a URL to start
          </div>
        )}
        {shotFlash && <div className="pointer-events-none absolute inset-0 bg-white/70 transition-opacity" />}
      </div>
    </div>
  );
}
