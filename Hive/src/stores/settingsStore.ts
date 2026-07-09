import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ApiKeys {
  anthropic: string;
  openai: string;
  google: string;
  openrouter: string;
  moonshot: string; // For Kimi Code
}

interface SettingsState {
  apiKeys: ApiKeys;
  setApiKey: (provider: keyof ApiKeys, value: string) => void;
  autosaveEnabled: boolean;
  setAutosaveEnabled: (enabled: boolean) => void;
  autosaveInterval: number;
  setAutosaveInterval: (interval: number) => void;
  defaultWorkerBee: string;
  setDefaultWorkerBee: (cli: string) => void;
  nectarTokenBudget: number;
  setNectarTokenBudget: (budget: number) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      apiKeys: { anthropic: "", openai: "", google: "", openrouter: "", moonshot: "" },
      setApiKey: (provider, value) =>
        set((state) => ({
          apiKeys: { ...state.apiKeys, [provider]: value },
        })),
      autosaveEnabled: true,
      setAutosaveEnabled: (enabled) => set({ autosaveEnabled: enabled }),
      autosaveInterval: 30000, // 30 seconds default
      setAutosaveInterval: (interval) => set({ autosaveInterval: interval }),
      defaultWorkerBee: "claude",
      setDefaultWorkerBee: (cli) => set({ defaultWorkerBee: cli }),
      nectarTokenBudget: 4000,
      setNectarTokenBudget: (budget) => set({ nectarTokenBudget: budget }),
    }),
    { name: "hiveory-settings" },
  ),
);

// Maps a CLI's real executable name to the env vars it needs to authenticate.
// Aider supports both Anthropic and OpenAI models, so it gets both keys.
export function envForCli(command: string, apiKeys: ApiKeys): Record<string, string> {
  const env: Record<string, string> = {};
  switch (command) {
    case "claude":
      if (apiKeys.anthropic) env.ANTHROPIC_API_KEY = apiKeys.anthropic;
      break;
    case "codex":
      if (apiKeys.openai) env.OPENAI_API_KEY = apiKeys.openai;
      break;
    case "gemini":
      if (apiKeys.google) {
        env.GEMINI_API_KEY = apiKeys.google;
        env.GOOGLE_API_KEY = apiKeys.google;
      }
      break;
    case "aider":
      if (apiKeys.anthropic) env.ANTHROPIC_API_KEY = apiKeys.anthropic;
      if (apiKeys.openai) env.OPENAI_API_KEY = apiKeys.openai;
      break;
    case "opencode":
      if (apiKeys.openrouter) env.OPENROUTER_API_KEY = apiKeys.openrouter;
      if (apiKeys.anthropic) env.ANTHROPIC_API_KEY = apiKeys.anthropic;
      break;
    case "kimi":
      if (apiKeys.moonshot) env.MOONSHOT_API_KEY = apiKeys.moonshot;
      break;
    case "cline":
      if (apiKeys.anthropic) env.ANTHROPIC_API_KEY = apiKeys.anthropic;
      if (apiKeys.openrouter) env.OPENROUTER_API_KEY = apiKeys.openrouter;
      break;
  }
  return env;
}
