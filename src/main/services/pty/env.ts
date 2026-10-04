/** Variables that must never leak from Hiveory's own process into agent shells. */
const ALWAYS_STRIPPED = ['ELECTRON_RUN_AS_NODE', 'ELECTRON_NO_ATTACH_CONSOLE', 'ELECTRON_ENABLE_LOGGING']

/**
 * Builds an agent's environment. When Hiveory itself was started from inside
 * a Claude Code session (CLAUDECODE is set), that host session's variables
 * are dropped so nested agents start clean instead of inheriting its
 * transcript, session and messaging settings. User config such as
 * ANTHROPIC_* is kept.
 */
export const sanitizeEnv = (
  base: Record<string, string | undefined>,
  overrides: Record<string, string | undefined> = {}
): Record<string, string> => {
  const insideClaudeSession = Boolean(base.CLAUDECODE)
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries({ ...base, ...overrides })) {
    if (value === undefined || ALWAYS_STRIPPED.includes(key)) continue
    if (insideClaudeSession && (key === 'CLAUDECODE' || key === 'AI_AGENT' || key.startsWith('CLAUDE_'))) continue
    env[key] = value
  }
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  return env
}
