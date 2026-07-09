import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ApiKeys {
  anthropic: string;
  openai: string;
  google: string;
}

interface SettingsState {
  apiKeys: ApiKeys;
  setApiKey: (provider: keyof ApiKeys, value: string) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      apiKeys: { anthropic: "", openai: "", google: "" },
      setApiKey: (provider, value) =>
        set((state) => ({
          apiKeys: { ...state.apiKeys, [provider]: value },
        })),
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
  }
  return env;
}
