import type { CliAdapter } from './types'

/**
 * Model-provider login and endpoint variables that many CLIs read (Claude Code, Codex, Gemini,
 * OpenCode, Aider, Goose, Crush…). Like each adapter's own `loginEnv`, they always come from the
 * user's saved environment when Hiveory starts a process, never from whatever launched Hiveory
 * (ADR 0063). `NAME_*` matches every variable starting with `NAME_`.
 */
export const PROVIDER_LOGIN_ENV: readonly string[] = [
  'ANTHROPIC_*',
  'OPENAI_*',
  'AZURE_OPENAI_*',
  'GEMINI_*',
  'GOOGLE_API_KEY',
  'GOOGLE_GENAI_*',
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_CLOUD_LOCATION',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'VERTEXAI_*',
  'AWS_BEARER_TOKEN_BEDROCK',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_PROFILE',
  'AWS_REGION',
  'OPENROUTER_*',
  'DEEPSEEK_*',
  'MISTRAL_*',
  'GROQ_*',
  'XAI_*',
  'MOONSHOT_*',
  'DASHSCOPE_*',
  'TOGETHER_*',
  'FIREWORKS_*',
  'CEREBRAS_*',
  'PERPLEXITY_*',
  'COHERE_*',
  'OLLAMA_HOST'
]

/** Every login variable Hiveory refreshes: the shared provider list plus each adapter's own, without repeats. */
export const loginEnvPatterns = (adapters: readonly Pick<CliAdapter, 'loginEnv'>[]): string[] => [
  ...new Set([...PROVIDER_LOGIN_ENV, ...adapters.flatMap((a) => a.loginEnv ?? [])])
]
