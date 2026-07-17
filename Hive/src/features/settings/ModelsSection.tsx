"use client";

import { useProviderStore } from "@/features/settings/providerStore";
import { Check } from "lucide-react";
import { useState } from "react";
import { useSettingsStore } from "@/features/settings/settingsStore";

export default function ModelsSection() {
  const availableModels = useProviderStore((s) => s.availableModels);
  const providers = useProviderStore((s) => s.providers);

  const queenbeeModel = useSettingsStore((s) => s.queenbeeModel);
  const setQueenbeeModel = useSettingsStore((s) => s.setQueenbeeModel);

  const grouped: Record<string, typeof availableModels> = {};
  for (const m of availableModels) {
    if (!grouped[m.providerName]) grouped[m.providerName] = [];
    grouped[m.providerName].push(m);
  }

  const providerNames = providers
    .filter((p) => p.verified && p.enabled)
    .map((p) => p.name);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-bee-text">Models</h2>
        <p className="text-[10px] text-bee-textMuted mt-0.5">
          All models from verified providers. Select a model for QueenBee to use.
        </p>
      </div>

      {availableModels.length === 0 ? (
        <div className="text-xs text-bee-textMuted bg-bee-canvas/40 rounded-lg px-4 py-6 text-center border border-bee-border/30">
          No models available. Connect a provider in the Providers section first.
        </div>
      ) : (
        <div className="space-y-3">
          {Object.entries(grouped).map(([providerName, models]) => (
            <div key={providerName} className="bg-bee-canvas/40 rounded-lg border border-bee-border/30 overflow-hidden">
              <div className="px-3 py-2 bg-bee-canvas/60 border-b border-bee-border/20">
                <span className="text-xs font-semibold text-bee-textDim">{providerName}</span>
                <span className="text-[10px] text-bee-textMuted ml-2">({models.length} models)</span>
              </div>
              <div className="divide-y divide-bee-border/10">
                {models.map((m) => (
                  <label
                    key={`${m.providerId}-${m.model}`}
                    className="flex items-center gap-3 px-3 py-2 hover:bg-bee-border/20 cursor-pointer transition-colors"
                  >
                    <input
                      type="radio"
                      name="queenbee-model"
                      checked={queenbeeModel === m.model}
                      onChange={() => setQueenbeeModel(m.model)}
                      className="accent-bee-gold"
                    />
                    <span className="flex-1 text-xs text-bee-text font-mono">{m.model}</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-bee-gold/10 text-bee-gold border border-bee-gold/20">
                      {m.providerName}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
