"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { MessageSquareText, RefreshCw, KeyRound, ExternalLink, ShieldCheck, Zap, Maximize2, Minimize2 } from "lucide-react";
import type { HivePluginProps } from "../../types";
import { GlassChatPlatformAPI } from "./platformApi";

declare global {
  interface Window {
    GlassChat?: {
      mount: (selector: string | HTMLElement, options: Record<string, any>) => any;
      unmount?: (selector: string | HTMLElement) => void;
    };
  }
}

export interface GlassChatEmbedProps extends HivePluginProps {
  appId?: string;
  token?: string;
  baseUrl?: string;
  layout?: "embedded" | "desktop" | "fullscreen";
  authMode?: "partner" | "user";
  themeName?: string;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

// Credentials come from the host app's Vite env (Hive/.env), not source.
// `as any` keeps this compiling in HivePlugins' standalone tsc, which has no
// vite/client types. Both are still overridable at runtime via Partner Config.
const ENV = (((import.meta as any) ?? {}).env ?? {}) as Record<string, string | undefined>;
const DEFAULT_APP_ID = ENV.VITE_GLASSCHAT_APP_ID ?? "";
const DEFAULT_API_KEY = ENV.VITE_GLASSCHAT_API_KEY ?? "";
const DEFAULT_TEAM_ID = ENV.VITE_GLASSCHAT_TEAM_ID ?? "team_hiveory_workspace";
const DEFAULT_USER_ID = ENV.VITE_GLASSCHAT_USER_ID ?? "usr_hiveory_owner";

const STORAGE_KEYS = {
  APP_ID: "hive_glasschat_app_id",
  TOKEN: "hive_glasschat_token",
  API_KEY: "hive_glasschat_api_key",
  TEAM_ID: "hive_glasschat_team_id",
  USER_ID: "hive_glasschat_user_id",
};

export function GlassChatEmbed({
  appId = DEFAULT_APP_ID,
  token,
  baseUrl = "https://glasschat.app",
  layout = "embedded",
  authMode = "partner",
  themeName = "glasschat",
  isExpanded: propIsExpanded,
  onToggleExpand,
}: GlassChatEmbedProps) {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const isExpanded = propIsExpanded ?? internalExpanded;
  const handleToggleExpand = onToggleExpand ?? (() => setInternalExpanded((prev) => !prev));
  const effectiveLayout = isExpanded ? (layout === "embedded" ? "desktop" : layout) : layout;

  const containerRef = useRef<HTMLDivElement>(null);
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Credentials
  const [configuredAppId, setConfiguredAppId] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEYS.APP_ID) || appId;
  });
  const [configuredToken, setConfiguredToken] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEYS.TOKEN) || token || "";
  });
  const [apiKey, setApiKey] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEYS.API_KEY) || DEFAULT_API_KEY;
  });
  const [teamId, setTeamId] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEYS.TEAM_ID) || DEFAULT_TEAM_ID;
  });
  const [userId, setUserId] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEYS.USER_ID) || DEFAULT_USER_ID;
  });

  const [isConfiguring, setIsConfiguring] = useState<boolean>(false);

  // Dynamic script loader for official GlassChat embed bundle
  useEffect(() => {
    const scriptId = "glasschat-embed-script";
    let existingScript = document.getElementById(scriptId) as HTMLScriptElement;

    if (window.GlassChat) {
      setScriptLoaded(true);
      return;
    }

    if (!existingScript) {
      existingScript = document.createElement("script");
      existingScript.id = scriptId;
      existingScript.src = `${baseUrl}/embed/glasschat.embed.js`;
      existingScript.async = true;
      existingScript.onload = () => setScriptLoaded(true);
      existingScript.onerror = () => {
        setError("Failed to load hosted GlassChat embed script (https://glasschat.app/embed/glasschat.embed.js)");
        setLoading(false);
      };
      document.head.appendChild(existingScript);
    } else {
      existingScript.addEventListener("load", () => setScriptLoaded(true));
    }
  }, [baseUrl]);

  // Provision & Mint Embed Session Token automatically for Partner Mode
  const initPartnerSession = useCallback(async () => {
    if (!apiKey) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const client = new GlassChatPlatformAPI({ baseUrl, platformApiKey: apiKey });

      let activeTeamId = teamId;
      try {
        const teamRes = await client.provisionTeam({
          externalTeamId: teamId,
          tenantId: "hiveory_tenant",
          name: "Hiveory Workspace",
        });
        if (teamRes?.id) activeTeamId = teamRes.id;
      } catch (e) {
        console.warn("Provision team warning:", e);
      }

      // Member must exist before an embed session can be minted, else the
      // embed-session route returns 404 member_not_found.
      try {
        await client.ensureMember(activeTeamId, userId, "Hiveory Owner");
      } catch (e) {
        console.warn("Ensure member warning:", e);
      }

      let session: any = null;
      try {
        session = await client.issueEmbedSession(activeTeamId, userId, configuredAppId);
      } catch (e) {
        if (activeTeamId !== teamId) {
          await client.ensureMember(teamId, userId, "Hiveory Owner").catch(() => {});
          session = await client.issueEmbedSession(teamId, userId, configuredAppId);
        } else {
          throw e;
        }
      }

      if (session?.token) {
        setConfiguredToken(session.token);
        localStorage.setItem(STORAGE_KEYS.TOKEN, session.token);
        localStorage.setItem(STORAGE_KEYS.APP_ID, configuredAppId);
        localStorage.setItem(STORAGE_KEYS.API_KEY, apiKey);
        localStorage.setItem(STORAGE_KEYS.TEAM_ID, teamId);
        localStorage.setItem(STORAGE_KEYS.USER_ID, userId);
      } else {
        throw new Error("Failed to obtain embed session token");
      }
    } catch (e: any) {
      console.error("GlassChat Partner Mode Initialization Error:", e);
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [apiKey, baseUrl, configuredAppId, teamId, userId]);

  // Initial auto-mint if token is missing
  useEffect(() => {
    if (!configuredToken && apiKey) {
      initPartnerSession();
    } else {
      setLoading(false);
    }
  }, [configuredToken, apiKey, initPartnerSession]);

  // Mount GlassChat instance into container in Partner Mode
  useEffect(() => {
    if (loading || isConfiguring || !scriptLoaded || !containerRef.current || !window.GlassChat) return;

    try {
      const targetEl = containerRef.current;
      targetEl.innerHTML = ""; // Clear container

      window.GlassChat.mount(targetEl, {
        appId: configuredAppId,
        ...(configuredToken ? { token: configuredToken } : {}),
        baseUrl,
        layout: effectiveLayout,
        themeSource: "host",
        themeName,
        authMode: "partner",
      });

      return () => {
        if (window.GlassChat?.unmount && targetEl) {
          try {
            window.GlassChat.unmount(targetEl);
          } catch (e) {
            // Ignore unmount error
          }
        }
      };
    } catch (e: any) {
      console.error("GlassChat Partner Mount Error:", e);
      setError(String(e?.message || e));
    }
  }, [scriptLoaded, configuredAppId, configuredToken, baseUrl, effectiveLayout, themeName, isConfiguring, loading]);

  if (isConfiguring) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-5 text-center text-bee-text overflow-y-auto scrollbar-sleek">
        <div className="flex size-11 items-center justify-center rounded-2xl border border-bee-gold/40 bg-bee-gold/10 text-bee-gold">
          <ShieldCheck size={24} />
        </div>
        <h3 className="font-display mt-3 text-sm font-semibold text-bee-text">
          GlassChat Partner Mode Configuration
        </h3>
        <p className="mt-1 max-w-[36ch] text-[11px] text-bee-textMuted leading-relaxed">
          Zero sign-in screens. Configured with your App ID and Platform API Key.
        </p>

        <div className="mt-4 w-full max-w-xs space-y-3 text-left">
          <div>
            <label className="block text-[11px] font-medium text-bee-gold mb-1">
              App ID
            </label>
            <input
              type="text"
              value={configuredAppId}
              onChange={(e) => setConfiguredAppId(e.target.value)}
              placeholder="app_..."
              className="w-full rounded-md border border-bee-border/60 bg-bee-canvas/80 px-2.5 py-1.5 text-xs text-bee-text font-mono outline-none focus:border-bee-gold/60"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-bee-textDim mb-1">
              Platform API Key (gcp_...)
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="gcp_..."
              className="w-full rounded-md border border-bee-border/60 bg-bee-canvas/80 px-2.5 py-1.5 text-xs text-bee-text font-mono outline-none focus:border-bee-gold/60"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-bee-textDim mb-1">
              Embed Session Token (Optional Override)
            </label>
            <input
              type="password"
              value={configuredToken}
              onChange={(e) => setConfiguredToken(e.target.value)}
              placeholder="emb_..."
              className="w-full rounded-md border border-bee-border/60 bg-bee-canvas/80 px-2.5 py-1.5 text-xs text-bee-text font-mono outline-none focus:border-bee-gold/60"
            />
          </div>

          {error && <p className="text-[10px] text-bee-err mt-1 text-center">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button
              onClick={initPartnerSession}
              disabled={loading}
              className="flex-1 flex items-center justify-center gap-1 rounded-lg bg-bee-gold/20 border border-bee-gold/40 px-3 py-1.5 text-xs font-semibold text-bee-goldHi hover:bg-bee-gold/30 transition-colors disabled:opacity-50"
            >
              <Zap size={13} /> Auto-Mint
            </button>
            <button
              onClick={() => setIsConfiguring(false)}
              className="flex-1 rounded-lg bg-bee-gold px-3 py-1.5 text-xs font-semibold text-bee-ink transition-opacity hover:opacity-90"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-bee-surface/50">
      {/* Top Banner Header */}
      <div className="flex items-center justify-between border-b border-bee-border/40 bg-bee-surface/90 px-3 py-1.5 text-[11px]">
        <span className="flex items-center gap-1.5 font-medium text-bee-gold">
          <ShieldCheck size={13} />
          GlassChat Workspace
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={handleToggleExpand}
            className="flex items-center gap-1 text-bee-textMuted hover:text-bee-gold text-[10px] p-1 rounded hover:bg-bee-border/30 transition-colors"
            title={isExpanded ? "Exit full screen" : "Expand to full screen"}
          >
            {isExpanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </button>
          <button
            onClick={() => setIsConfiguring(true)}
            className="flex items-center gap-1 text-bee-textMuted hover:text-bee-text text-[10px]"
            title="Configure Partner Keys"
          >
            <KeyRound size={11} /> Partner Config
          </button>
          <a
            href="https://glasschat.app"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-bee-textMuted hover:text-bee-text text-[10px]"
          >
            <ExternalLink size={11} />
          </a>
        </div>
      </div>

      {/* Main Container */}
      <div className="relative flex-1 overflow-hidden">
        {loading ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-bee-surface/90 backdrop-blur-sm z-10 text-bee-textMuted">
            <RefreshCw className="size-5 animate-spin text-bee-gold mb-2" />
            <span className="text-xs font-semibold text-bee-text">Connecting GlassChat Workspace…</span>
            <span className="text-[10px] text-bee-textMuted mt-0.5">Provisioning Partner Session</span>
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center p-4 text-center">
            <p className="text-xs text-bee-err font-medium mb-1">Partner Session Error</p>
            <p className="text-[11px] text-bee-textMuted max-w-[32ch]">{error}</p>
            <button
              onClick={initPartnerSession}
              className="mt-3 flex items-center gap-1.5 rounded-md bg-bee-gold/15 border border-bee-gold/30 px-3 py-1 text-xs text-bee-goldHi hover:bg-bee-gold/25 transition-colors"
            >
              <RefreshCw size={12} /> Retry Connection
            </button>
          </div>
        ) : (
          <div ref={containerRef} id="glasschat-container" className="h-full w-full" />
        )}
      </div>
    </div>
  );
}
