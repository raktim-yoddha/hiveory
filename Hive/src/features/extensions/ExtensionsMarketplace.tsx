"use client";

import { useEffect, useState, useCallback } from "react";
import { Search, X, Blocks, Download, Check, RefreshCw, Trash2 } from "lucide-react";
import { searchOpenVsx, type OpenVsxResult } from "./openVsxApi";
import { useExtensionStore } from "./extensionStore";

/**
 * VS Code-style Open-VSX marketplace, opened from the title bar. Search, browse
 * and "download" extensions; downloaded ones show up in the HoneyFlow + menu.
 */
export default function ExtensionsMarketplace({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<OpenVsxResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const installed = useExtensionStore((s) => s.installed);
  const install = useExtensionStore((s) => s.install);
  const uninstall = useExtensionStore((s) => s.uninstall);
  const isInstalled = useExtensionStore((s) => s.isInstalled);

  const run = useCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    try {
      setResults(await searchOpenVsx(q));
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  // initial popular list
  useEffect(() => { run(""); }, [run]);
  // debounced search
  useEffect(() => {
    const t = setTimeout(() => run(query), 350);
    return () => clearTimeout(t);
  }, [query, run]);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-6" onClick={onClose}>
      <div
        className="flex h-[80vh] w-[min(920px,92vw)] flex-col overflow-hidden rounded-2xl border border-bee-border/60 bg-bee-surface shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-bee-border/50 glass-toolbar px-3">
          <Blocks className="size-4 text-bee-gold" />
          <span className="text-sm font-semibold text-bee-text">Extensions</span>
          <span className="text-[11px] text-bee-textMuted">Open-VSX marketplace</span>
          <button onClick={onClose} className="ml-auto rounded p-1 text-bee-textMuted hover:bg-bee-border/40 hover:text-bee-text">
            <X className="size-4" />
          </button>
        </div>

        {/* search */}
        <div className="shrink-0 border-b border-bee-border/40 px-3 py-2">
          <div className="flex h-8 items-center gap-2 rounded-md border border-bee-border/60 bg-bee-canvas/60 px-2 focus-within:border-bee-gold/50">
            <Search className="size-3.5 text-bee-textMuted" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search Open-VSX (e.g. python, prettier, gitlens)…"
              className="min-w-0 flex-1 bg-transparent text-xs text-bee-text outline-none placeholder:text-bee-textMuted/60"
            />
          </div>
        </div>

        {/* results */}
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek p-2">
          {loading ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-bee-textMuted">
              <RefreshCw className="size-5 animate-spin text-bee-gold" />
              <span className="text-xs">Searching…</span>
            </div>
          ) : error ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <p className="text-xs font-medium text-bee-err">Couldn't reach Open-VSX</p>
              <p className="max-w-[40ch] text-[11px] text-bee-textMuted">{error}</p>
              <button onClick={() => run(query)} className="mt-1 flex items-center gap-1.5 rounded-md border border-bee-gold/30 px-3 py-1 text-xs text-bee-goldHi hover:bg-bee-gold/10">
                <RefreshCw className="size-3" /> Retry
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {results.map((e) => {
                const has = isInstalled(e.id);
                return (
                  <div key={e.id} className="flex items-start gap-2.5 rounded-lg border border-bee-border/40 bg-bee-canvas/40 p-2.5 transition-colors hover:border-bee-border/70">
                    <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-bee-surface">
                      {e.icon ? (
                        <img src={e.icon} alt="" className="size-9 object-contain" loading="lazy" />
                      ) : (
                        <Blocks className="size-4 text-bee-gold" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-xs font-semibold text-bee-text">{e.name}</span>
                        <span className="shrink-0 text-[9px] text-bee-textMuted">{e.publisher}</span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-[10px] leading-[1.4] text-bee-textMuted">{e.description}</p>
                    </div>
                    {has ? (
                      <button
                        onClick={() => uninstall(e.id)}
                        className="flex shrink-0 items-center gap-1 rounded-md border border-bee-border/60 px-2 py-1 text-[10px] font-medium text-bee-textDim hover:text-bee-err"
                        title="Remove"
                      >
                        <Check className="size-3 text-[#22c55e]" /> Added
                      </button>
                    ) : (
                      <button
                        onClick={() => install({ id: e.id, name: e.name, publisher: e.publisher, icon: e.icon, version: e.version })}
                        className="flex shrink-0 items-center gap-1 rounded-md bg-bee-gold/15 border border-bee-gold/30 px-2 py-1 text-[10px] font-semibold text-bee-goldHi hover:bg-bee-gold/25"
                      >
                        <Download className="size-3" /> Get
                      </button>
                    )}
                  </div>
                );
              })}
              {results.length === 0 && (
                <div className="col-span-full py-10 text-center text-xs text-bee-textMuted">No extensions found.</div>
              )}
            </div>
          )}
        </div>

        {/* footer: installed count */}
        {installed.length > 0 && (
          <div className="flex shrink-0 items-center gap-2 border-t border-bee-border/40 px-3 py-1.5 text-[10px] text-bee-textMuted">
            <Trash2 className="size-3" /> {installed.length} downloaded — open them from the HoneyFlow <span className="text-bee-gold">+</span> menu.
          </div>
        )}
      </div>
    </div>
  );
}
