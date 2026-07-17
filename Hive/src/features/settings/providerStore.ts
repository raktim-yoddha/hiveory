import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ProviderConfig {
  id: string;
  name: string;
  type: 'builtin' | 'custom';
  apiType: 'openai-compatible' | 'openai-responses' | 'anthropic-messages';
  baseUrl: string;
  apiKey: string;
  headers: Record<string, string>;
  enabled: boolean;
  verified: boolean;
  models: string[];
  verifyError?: string;
  order: number;
}

export interface ProviderTemplate {
  id: string;
  name: string;
  description: string;
  apiType: ProviderConfig['apiType'];
  baseUrl: string;
}

export const POPULAR_PROVIDERS: ProviderTemplate[] = [
  { id: 'anthropic', name: 'Anthropic', description: 'Claude models — Sonnet, Haiku, Opus', apiType: 'anthropic-messages', baseUrl: 'https://api.anthropic.com/v1' },
  { id: 'openai', name: 'OpenAI', description: 'GPT-4o, GPT-4o-mini, o3, o4-mini', apiType: 'openai-compatible', baseUrl: 'https://api.openai.com/v1' },
  { id: 'google', name: 'Google (Antigravity)', description: 'Gemini 2.5 Flash, Gemini 2.5 Pro', apiType: 'openai-compatible', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  { id: 'deepseek', name: 'DeepSeek', description: 'DeepSeek V3, DeepSeek R1', apiType: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1' },
  { id: 'openrouter', name: 'OpenRouter', description: 'Unified API for 200+ models', apiType: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'opencode-go', name: 'OpenCode Go', description: 'OpenCode CLI via API key', apiType: 'openai-compatible', baseUrl: 'https://api.opencode.ai/v1' },
  { id: 'opencode-zen', name: 'OpenCode Zen', description: 'OpenCode Zen hosted models (free tier)', apiType: 'openai-compatible', baseUrl: 'https://zen.opencode.ai/v1' },
];

export const EXTRA_PROVIDERS: ProviderTemplate[] = [
  { id: 'github-copilot', name: 'GitHub Copilot', description: 'Copilot models via GitHub token', apiType: 'openai-compatible', baseUrl: 'https://api.githubcopilot.com/v1' },
  { id: 'together', name: 'Together AI', description: 'Open-source and fine-tuned models', apiType: 'openai-compatible', baseUrl: 'https://api.together.xyz/v1' },
  { id: 'groq', name: 'Groq', description: 'Fast inference on open models', apiType: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1' },
  { id: 'fireworks', name: 'Fireworks AI', description: 'Serverless inference for open models', apiType: 'openai-compatible', baseUrl: 'https://api.fireworks.ai/inference/v1' },
];

export interface AvailableModel {
  model: string;
  providerId: string;
  providerName: string;
}

interface ProviderState {
  providers: ProviderConfig[];
  disabledProviderIds: string[];
  availableModels: AvailableModel[];
  addProvider: (config: ProviderConfig) => void;
  removeProvider: (id: string) => void;
  updateProvider: (id: string, updates: Partial<ProviderConfig>) => void;
  setProviderVerified: (id: string, verified: boolean, models: string[], error?: string) => void;
  toggleProviderEnabled: (id: string) => void;
  toggleDisabled: (id: string) => void;
  isConnected: (id: string) => boolean;
}

function computeAvailableModels(providers: ProviderConfig[]): AvailableModel[] {
  const all: AvailableModel[] = [];
  for (const p of providers) {
    if (p.verified && p.enabled) {
      for (const m of p.models) {
        all.push({ model: m, providerId: p.id, providerName: p.name });
      }
    }
  }
  return all;
}

function nextOrder(providers: ProviderConfig[]): number {
  return providers.length > 0 ? Math.max(...providers.map(p => p.order)) + 1 : 0;
}

export const useProviderStore = create<ProviderState>()(
  persist(
    (set, get) => ({
      providers: [],
      disabledProviderIds: [],
      availableModels: [],

      addProvider: (config) =>
        set((state) => {
          const providers = [...state.providers, { ...config, order: nextOrder(state.providers) }];
          return { providers, availableModels: computeAvailableModels(providers) };
        }),

      removeProvider: (id) =>
        set((state) => {
          const providers = state.providers.filter((p) => p.id !== id);
          return { providers, availableModels: computeAvailableModels(providers) };
        }),

      updateProvider: (id, updates) =>
        set((state) => {
          const providers = state.providers.map((p) => (p.id === id ? { ...p, ...updates } : p));
          return { providers, availableModels: computeAvailableModels(providers) };
        }),

      setProviderVerified: (id, verified, models, error) =>
        set((state) => {
          const providers = state.providers.map((p) =>
            p.id === id ? { ...p, verified, models, verifyError: error } : p
          );
          return { providers, availableModels: computeAvailableModels(providers) };
        }),

      toggleProviderEnabled: (id) =>
        set((state) => {
          const providers = state.providers.map((p) =>
            p.id === id ? { ...p, enabled: !p.enabled } : p
          );
          return { providers, availableModels: computeAvailableModels(providers) };
        }),

      toggleDisabled: (id) =>
        set((state) => {
          const isDisabled = state.disabledProviderIds.includes(id);
          return {
            disabledProviderIds: isDisabled
              ? state.disabledProviderIds.filter((d) => d !== id)
              : [...state.disabledProviderIds, id],
          };
        }),

      isConnected: (id) => {
        const p = get().providers.find((p) => p.id === id);
        return !!p && p.verified && p.enabled;
      },
    }),
    { name: 'hiveory-providers', partialize: (state) => ({ providers: state.providers, disabledProviderIds: state.disabledProviderIds }) },
  ),
);
