"use client";

import { useState } from "react";
import { Plus, Globe, ChevronDown, ChevronUp, Trash2, Pencil, Check, X, AlertCircle, Loader2 } from "lucide-react";
import { useProviderStore, POPULAR_PROVIDERS, EXTRA_PROVIDERS, type ProviderConfig, type ProviderTemplate } from "@/features/settings/providerStore";

function VerifyButton({ disabled, verifying, onClick }: { disabled: boolean; verifying: boolean; onClick: () => void }) {
  return (
    <button
      disabled={disabled || verifying}
      onClick={onClick}
      className="px-3 py-1.5 rounded-lg text-xs bg-bee-gold/10 border border-bee-gold/20 text-bee-goldHi hover:bg-bee-gold/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
    >
      {verifying ? (
        <>
          <Loader2 size={12} className="animate-spin" />
          Verifying...
        </>
      ) : (
        "Verify & Connect"
      )}
    </button>
  );
}

function ConnectForm({
  template,
  existing,
  onDone,
}: {
  template?: ProviderTemplate;
  existing?: ProviderConfig;
  onDone: () => void;
}) {
  const addProvider = useProviderStore((s) => s.addProvider);
  const updateProvider = useProviderStore((s) => s.updateProvider);
  const setProviderVerified = useProviderStore((s) => s.setProviderVerified);

  const isCustom = !template;
  const isEdit = !!existing;

  const [id, setId] = useState(existing?.id || template?.id || "");
  const [name, setName] = useState(existing?.name || template?.name || "");
  const [apiType, setApiType] = useState<ProviderConfig["apiType"]>(
    existing?.apiType || template?.apiType || "openai-compatible"
  );
  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl || template?.baseUrl || "");
  const [apiKey, setApiKey] = useState(existing?.apiKey || "");
  const [headers, setHeaders] = useState<Record<string, string>>(existing?.headers || {});
  const [newHeaderKey, setNewHeaderKey] = useState("");
  const [newHeaderVal, setNewHeaderVal] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState("");

  const builtinIds = new Set(POPULAR_PROVIDERS.map((p) => p.id));

  const isBuiltin = !isCustom && builtinIds.has(id);

  const handleVerify = async () => {
    setVerifying(true);
    setVerifyError("");

    try {
      let apiUrl = "";
      let fetchHeaders: Record<string, string> = { ...headers };

      if (apiType === "anthropic-messages") {
        apiUrl = "https://api.anthropic.com/v1/models";
        fetchHeaders["x-api-key"] = apiKey;
        fetchHeaders["anthropic-version"] = "2023-06-01";
      } else {
        const base = baseUrl.replace(/\/+$/, "");
        apiUrl = `${base}/models`;
        if (apiKey) {
          fetchHeaders["Authorization"] = `Bearer ${apiKey}`;
        }
      }

      const resp = await fetch(apiUrl, { headers: fetchHeaders });

      if (resp.status === 401) {
        setVerifyError("Invalid API Key");
        setVerifying(false);
        return;
      }

      if (!resp.ok) {
        setVerifyError(`Connection Error: HTTP ${resp.status}`);
        setVerifying(false);
        return;
      }

      let data: any;
      try {
        data = await resp.json();
      } catch {
        setVerifyError("Connection Error: Invalid response");
        setVerifying(false);
        return;
      }

      let models: string[] = [];
      if (apiType === "anthropic-messages") {
        models = (data?.data || []).map((m: any) => m.id).filter(Boolean);
      } else {
        models = (data?.data || []).map((m: any) => m.id).filter(Boolean);
      }

      if (models.length === 0) {
        setVerifyError("Model Not Found");
        setVerifying(false);
        return;
      }

      const config: ProviderConfig = {
        id: isCustom ? id : (template?.id || id),
        name: name || (template?.name || id),
        type: isCustom ? "custom" : "builtin",
        apiType,
        baseUrl,
        apiKey,
        headers,
        enabled: true,
        verified: true,
        models,
        order: 0,
      };

      if (isEdit && existing) {
        updateProvider(existing.id, config);
        setProviderVerified(existing.id, true, models);
      } else {
        addProvider(config);
      }

      setVerifying(false);
      onDone();
    } catch (e: any) {
      setVerifyError(`Connection Error: ${e?.message || "Unknown error"}`);
      setVerifying(false);
    }
  };

  return (
    <div className="space-y-3 bg-bee-canvas/30 rounded-lg border border-bee-border/30 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-bee-text">
          {isEdit ? `Edit ${name}` : `Connect ${name || "Provider"}`}
        </span>
        <button
          onClick={onDone}
          className="p-1 rounded-md hover:bg-bee-border/60 text-bee-textMuted hover:text-bee-text transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      <div className="space-y-2">
        {isCustom && (
          <>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-bee-textMuted uppercase tracking-wider">Provider ID</label>
              <input
                type="text"
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder="my-provider"
                className="w-full bg-bee-canvas/70 border border-bee-border rounded-lg px-2.5 py-1.5 text-xs text-bee-text placeholder-bee-textMuted outline-none focus:ring-1 focus:ring-bee-gold transition-colors font-mono"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-bee-textMuted uppercase tracking-wider">Display Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Provider"
                className="w-full bg-bee-canvas/70 border border-bee-border rounded-lg px-2.5 py-1.5 text-xs text-bee-text placeholder-bee-textMuted outline-none focus:ring-1 focus:ring-bee-gold transition-colors"
              />
            </div>
          </>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-bee-textMuted uppercase tracking-wider">API Type</label>
          <select
            value={apiType}
            onChange={(e) => setApiType(e.target.value as ProviderConfig["apiType"])}
            className="w-full bg-bee-canvas/70 border border-bee-border rounded-lg px-2.5 py-1.5 text-xs text-bee-text outline-none focus:ring-1 focus:ring-bee-gold transition-colors"
          >
            <option value="openai-compatible">OpenAI Compatible</option>
            <option value="openai-responses">OpenAI Responses</option>
            <option value="anthropic-messages">Anthropic Messages</option>
          </select>
        </div>

        {apiType !== "anthropic-messages" && (
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-bee-textMuted uppercase tracking-wider">Base URL</label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={apiType === "openai-compatible" ? "https://api.openai.com/v1" : "https://api.openai.com/v1"}
              className="w-full bg-bee-canvas/70 border border-bee-border rounded-lg px-2.5 py-1.5 text-xs text-bee-text placeholder-bee-textMuted outline-none focus:ring-1 focus:ring-bee-gold transition-colors font-mono"
            />
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-bee-textMuted uppercase tracking-wider">API Key {isCustom && "(optional)"}</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={apiType === "anthropic-messages" ? "sk-ant-..." : "sk-..."}
            className="w-full bg-bee-canvas/70 border border-bee-border rounded-lg px-2.5 py-1.5 text-xs text-bee-text placeholder-bee-textMuted outline-none focus:ring-1 focus:ring-bee-gold transition-colors font-mono"
          />
        </div>

        {isCustom && (
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-bee-textMuted uppercase tracking-wider">Custom Headers</label>
            <div className="space-y-1.5">
              {Object.entries(headers).map(([k, v]) => (
                <div key={k} className="flex items-center gap-1.5">
                  <span className="text-[10px] font-mono text-bee-textDim flex-1 truncate">
                    {k}: {v}
                  </span>
                  <button
                    onClick={() => {
                      const next = { ...headers };
                      delete next[k];
                      setHeaders(next);
                    }}
                    className="p-0.5 rounded text-bee-textMuted hover:text-red-400 transition-colors"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={newHeaderKey}
                  onChange={(e) => setNewHeaderKey(e.target.value)}
                  placeholder="Header name"
                  className="flex-1 bg-bee-canvas/70 border border-bee-border rounded px-2 py-1 text-[10px] text-bee-text placeholder-bee-textMuted outline-none focus:ring-1 focus:ring-bee-gold transition-colors font-mono"
                />
                <input
                  type="text"
                  value={newHeaderVal}
                  onChange={(e) => setNewHeaderVal(e.target.value)}
                  placeholder="Value"
                  className="flex-1 bg-bee-canvas/70 border border-bee-border rounded px-2 py-1 text-[10px] text-bee-text placeholder-bee-textMuted outline-none focus:ring-1 focus:ring-bee-gold transition-colors font-mono"
                />
                <button
                  onClick={() => {
                    if (newHeaderKey.trim() && newHeaderVal.trim()) {
                      setHeaders({ ...headers, [newHeaderKey.trim()]: newHeaderVal.trim() });
                      setNewHeaderKey("");
                      setNewHeaderVal("");
                    }
                  }}
                  className="p-1 rounded text-bee-textMuted hover:text-bee-gold transition-colors"
                  disabled={!newHeaderKey.trim() || !newHeaderVal.trim()}
                >
                  <Plus size={12} />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {verifyError && (
        <div className="flex items-center gap-1.5 text-[10px] text-red-400 bg-red-400/10 rounded px-2 py-1.5 border border-red-400/20">
          <AlertCircle size={10} />
          {verifyError}
        </div>
      )}

      <div className="flex justify-end">
        <VerifyButton
          disabled={isBuiltin ? !apiKey : isCustom ? !id || !name : !apiKey}
          verifying={verifying}
          onClick={handleVerify}
        />
      </div>
    </div>
  );
}

function ProviderRow({ provider, isConnected = false, onConnect, onEdit, onDelete }: {
  provider: ProviderConfig | ProviderTemplate;
  isConnected?: boolean;
  onConnect?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const connected = isConnected || (provider as ProviderConfig).verified === true;
  const isCustom = (provider as ProviderConfig).type === "custom";
  const displayName = provider.name;

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 hover:bg-bee-border/20 transition-colors rounded-lg">
      <div className="w-6 h-6 rounded-full bg-bee-gold/10 border border-bee-gold/20 flex items-center justify-center flex-shrink-0">
        <Globe size={12} className="text-bee-gold" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-bee-text truncate">
            {displayName}
          </span>
          {isCustom && (
            <span className="text-[9px] px-1 py-0.5 rounded bg-bee-gold/10 text-bee-gold border border-bee-gold/20">
              CUSTOM
            </span>
          )}
        </div>
        {"description" in provider && provider.description ? (
          <p className="text-[10px] text-bee-textMuted mt-0.5 truncate">{provider.description}</p>
        ) : null}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {onEdit && (
          <button
            onClick={onEdit}
            className="p-1.5 rounded-md hover:bg-bee-border/60 text-bee-textMuted hover:text-bee-text transition-colors"
            title="Edit"
          >
            <Pencil size={12} />
          </button>
        )}
        {onDelete && (
          <button
            onClick={onDelete}
            className="p-1.5 rounded-md hover:bg-bee-border/60 text-bee-textMuted hover:text-red-400 transition-colors"
            title="Delete"
          >
            <Trash2 size={12} />
          </button>
        )}
        {onConnect && (
          <button
            onClick={onConnect}
            disabled={connected}
            className={`px-2.5 py-1 rounded-lg text-[10px] transition-colors flex items-center gap-1 ${
              connected
                ? "bg-green-500/10 text-green-400 border border-green-500/20 cursor-default"
                : "bg-bee-gold/10 border border-bee-gold/20 text-bee-goldHi hover:bg-bee-gold/20"
            }`}
          >
            {connected ? (
              <>
                <Check size={10} />
                Connected
              </>
            ) : (
              "+ Connect"
            )}
          </button>
        )}
      </div>
    </div>
  );
}

export default function ProvidersSection() {
  const providers = useProviderStore((s) => s.providers);
  const removeProvider = useProviderStore((s) => s.removeProvider);
  const toggleDisabled = useProviderStore((s) => s.toggleDisabled);
  const disabledProviderIds = useProviderStore((s) => s.disabledProviderIds);

  const [showExtra, setShowExtra] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const connectedProviders = providers.filter((p) => p.verified && p.enabled);
  const disabledProviders = providers.filter((p) => disabledProviderIds.includes(p.id));
  const connectedPopularIds = new Set(providers.filter((p) => p.verified).map((p) => p.id));

  const handleConnect = (template: ProviderTemplate) => {
    setConnecting(template.id);
    setEditing(null);
  };

  const handleEdit = (provider: ProviderConfig) => {
    setEditing(provider.id);
    setConnecting(null);
  };

  const handleDelete = (id: string) => {
    removeProvider(id);
  };

  const handleEnable = (id: string) => {
    toggleDisabled(id);
  };

  const handleFormDone = () => {
    setConnecting(null);
    setEditing(null);
  };

  const activeFormTemplate = connecting ? [...POPULAR_PROVIDERS, ...EXTRA_PROVIDERS].find((p) => p.id === connecting) : undefined;
  const activeFormExisting = editing ? providers.find((p) => p.id === editing) : undefined;
  const showForm = !!(connecting || editing);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-bee-text">Providers</h2>
        <p className="text-[10px] text-bee-textMuted mt-0.5">
          Connect and manage AI API providers for use across Hiveory.
        </p>
      </div>

      {connectedProviders.length > 0 && (
        <div>
          <h3 className="text-[10px] text-bee-textMuted uppercase tracking-wider mb-1.5 font-semibold">
            Connected Providers
          </h3>
          <div className="bg-bee-canvas/40 rounded-lg border border-bee-border/30 divide-y divide-bee-border/10">
            {connectedProviders.map((p) => (
              <ProviderRow
                key={p.id}
                provider={p}
                onEdit={() => handleEdit(p)}
                onDelete={() => handleDelete(p.id)}
              />
            ))}
          </div>
        </div>
      )}

      {!showForm && (
        <>
          <div>
            <h3 className="text-[10px] text-bee-textMuted uppercase tracking-wider mb-1.5 font-semibold">
              Popular Providers
            </h3>
            <div className="bg-bee-canvas/40 rounded-lg border border-bee-border/30 divide-y divide-bee-border/10">
              {POPULAR_PROVIDERS.map((t) => (
                <ProviderRow
                  key={t.id}
                  provider={t}
                  isConnected={connectedPopularIds.has(t.id)}
                  onConnect={() => handleConnect(t)}
                />
              ))}
            </div>
          </div>

          <div>
            <button
              onClick={() => setShowExtra(!showExtra)}
              className="flex items-center gap-1 text-[10px] text-bee-textMuted hover:text-bee-text transition-colors font-semibold uppercase tracking-wider"
            >
              {showExtra ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {showExtra ? "Hide Extra Providers" : "Show More Providers"}
              <span className="font-normal opacity-60">({EXTRA_PROVIDERS.length})</span>
            </button>
            {showExtra && (
              <div className="mt-1.5 bg-bee-canvas/40 rounded-lg border border-bee-border/30 divide-y divide-bee-border/10">
                {EXTRA_PROVIDERS.map((t) => (
                  <ProviderRow
                    key={t.id}
                    provider={t}
                    isConnected={connectedPopularIds.has(t.id)}
                    onConnect={() => handleConnect(t)}
                  />
                ))}
              </div>
            )}
          </div>

          {disabledProviders.length > 0 && (
            <div>
              <h3 className="text-[10px] text-bee-textMuted uppercase tracking-wider mb-1.5 font-semibold">
                Disabled Providers
              </h3>
              <div className="bg-bee-canvas/40 rounded-lg border border-bee-border/30 divide-y divide-bee-border/10">
                {disabledProviders.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="w-6 h-6 rounded-full bg-bee-border/30 flex items-center justify-center flex-shrink-0">
                      <Globe size={12} className="text-bee-textMuted" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-medium text-bee-textDim truncate">{p.name}</span>
                    </div>
                    <button
                      onClick={() => handleEnable(p.id)}
                      className="px-2.5 py-1 rounded-lg text-[10px] bg-bee-gold/10 border border-bee-gold/20 text-bee-goldHi hover:bg-bee-gold/20 transition-colors"
                    >
                      Enable
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {showForm && (
        <ConnectForm
          template={activeFormTemplate}
          existing={activeFormExisting}
          onDone={handleFormDone}
        />
      )}
    </div>
  );
}
