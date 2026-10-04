import type { IconReference, WaitingReason } from '@shared/domain'
import { GENERIC_WAITING_PATTERNS } from '../status/heuristics'
import { officialIcon } from './icons'
import { mcpServersJson, opencodeConfigJson } from './mcp-injection'
import type { CliAdapter, McpEndpoint } from './types'

/**
 * Declarative catalog of CLIs that need no native hooks. Each entry is a full
 * adapter; status comes from PTY heuristics (ADR 0006). Auto-approve flags are
 * only listed where the CLI documents one — otherwise the option is disabled.
 */
interface CliSpec {
  id: string
  displayName: string
  icon: IconReference
  executables: string[]
  /** Arguments always passed (e.g. a subcommand that starts the interactive session). */
  args?: string[]
  autoApproveArgs?: string[]
  autoApproveEnv?: Record<string, string>
  waitingPatterns?: Array<{ pattern: RegExp; reason: WaitingReason }>
  /** How this CLI loads Hiveory's agent-tools MCP server, if it can. */
  mcp?: (endpoint: McpEndpoint) => { args?: string[]; env?: Record<string, string> }
  /** How an agent gets its own conversation back after a restart (ADR 0014). */
  session?: {
    /** Hiveory chooses the session id up front (exact, per agent)… */
    start?: (id: string) => string[]
    resume?: (id: string) => string[]
    /** …or the CLI continues the folder's most recent session (used only for the folder's sole agent of that CLI). */
    latest?: string[]
  }
}

/** Prompts most agent CLIs use when they need a decision. */
const COMMON_PROMPTS: NonNullable<CliSpec['waitingPatterns']> = [
  { pattern: /Do you want to (?:proceed|run|allow|apply|make|create|execute)/i, reason: 'permission' },
  { pattern: /Allow (?:once|always)|Approve (?:once|always)/i, reason: 'permission' },
  { pattern: /(?:Allow|Approve|Run) (?:this )?(?:command|execution|tool|edit)\?/i, reason: 'permission' }
]


export const defineCli = (spec: CliSpec): CliAdapter => ({
  id: spec.id,
  displayName: spec.displayName,
  icon: spec.icon,
  executables: spec.executables,
  supportsAutoApprove: Boolean(spec.autoApproveArgs || spec.autoApproveEnv),
  injectMcp: Boolean(spec.mcp),
  buildLaunch: ({ instance, autoApprove, mcp, resume, soleOfCli }) => {
    const tools = mcp && spec.mcp ? spec.mcp(mcp) : {}
    const s = spec.session
    const session =
      s?.start && s.resume
        ? resume
          ? s.resume(instance.conversationId)
          : s.start(instance.conversationId)
        : resume && soleOfCli && s?.latest
          ? s.latest
          : []
    return {
      args: [...(spec.args ?? []), ...session, ...(autoApprove ? (spec.autoApproveArgs ?? []) : []), ...(tools.args ?? [])],
      env: { ...(autoApprove ? spec.autoApproveEnv : {}), ...tools.env }
    }
  },
  heuristics: () => ({
    waitingPatterns: [...(spec.waitingPatterns ?? []), ...COMMON_PROMPTS, ...GENERIC_WAITING_PATTERNS],
    workingOnSubmit: true,
    idleAfterSilenceMs: 4000
  })
})

export const CATALOG: CliAdapter[] = [
  defineCli({
    id: 'gemini',
    displayName: 'Gemini CLI',
    icon: officialIcon('gemini', 'GE'),
    executables: ['gemini'],
    autoApproveArgs: ['--yolo'],
    session: { latest: ['--resume', 'latest'] },
    waitingPatterns: [{ pattern: /Allow execution|Apply this change\?|Waiting for user confirmation/i, reason: 'permission' }]
  }),
  defineCli({
    id: 'opencode',
    displayName: 'OpenCode',
    icon: officialIcon('opencode', 'OP'),
    executables: ['opencode'],
    autoApproveArgs: ['--auto'],
    session: { latest: ['--continue'] },
    mcp: (endpoint) => ({ env: { OPENCODE_CONFIG_CONTENT: opencodeConfigJson(endpoint) } }),
    waitingPatterns: [{ pattern: /Permission required/i, reason: 'permission' }]
  }),
  defineCli({
    id: 'copilot',
    displayName: 'GitHub Copilot CLI',
    icon: officialIcon('copilot', 'CO'),
    executables: ['copilot'],
    autoApproveArgs: ['--allow-all-tools'],
    session: { latest: ['--continue'] },
    mcp: (endpoint) => ({ args: ['--additional-mcp-config', JSON.stringify(mcpServersJson(endpoint, { tools: ['*'] }))] })
  }),
  defineCli({
    id: 'cursor',
    displayName: 'Cursor CLI',
    icon: officialIcon('cursor', 'CU'),
    executables: ['cursor-agent'],
    autoApproveArgs: ['--force'],
    session: { latest: ['resume'] }
  }),
  defineCli({
    id: 'qwen',
    displayName: 'Qwen Code',
    icon: officialIcon('qwen', 'QW'),
    executables: ['qwen'],
    autoApproveArgs: ['--yolo'],
    session: { latest: ['--continue'] }
  }),
  defineCli({
    id: 'amp',
    displayName: 'Amp',
    icon: officialIcon('amp', 'AM'),
    executables: ['amp'],
    autoApproveArgs: ['--dangerously-allow-all']
  }),
  defineCli({
    id: 'aider',
    displayName: 'Aider',
    icon: officialIcon('aider', 'AI'),
    executables: ['aider'],
    autoApproveArgs: ['--yes-always'],
    session: { latest: ['--restore-chat-history'] }
  }),
  defineCli({
    id: 'goose',
    displayName: 'Goose',
    icon: officialIcon('goose', 'GO'),
    executables: ['goose'],
    args: ['session'],
    autoApproveEnv: { GOOSE_MODE: 'auto' },
    session: { latest: ['--resume'] }
  }),
  defineCli({
    id: 'crush',
    displayName: 'Crush',
    icon: officialIcon('crush', 'CR'),
    executables: ['crush'],
    autoApproveArgs: ['--yolo']
  }),
  defineCli({
    id: 'kimi',
    displayName: 'Kimi CLI',
    icon: officialIcon('kimi', 'KI'),
    executables: ['kimi'],
    autoApproveArgs: ['--yolo'],
    session: { latest: ['--continue'] }
  }),
  defineCli({
    id: 'kiro',
    displayName: 'Kiro CLI',
    icon: officialIcon('kiro', 'KI'),
    executables: ['kiro-cli'],
    args: ['chat'],
    autoApproveArgs: ['--trust-all-tools']
  }),
  defineCli({
    id: 'droid',
    displayName: 'Factory Droid',
    icon: officialIcon('droid', 'DR'),
    executables: ['droid']
  }),
  defineCli({
    id: 'auggie',
    displayName: 'Auggie',
    icon: officialIcon('auggie', 'AU'),
    executables: ['auggie']
  }),
  defineCli({
    id: 'cline',
    displayName: 'Cline CLI',
    icon: officialIcon('cline', 'CL'),
    executables: ['cline']
  }),
  defineCli({
    id: 'kilocode',
    displayName: 'Kilo Code CLI',
    icon: officialIcon('kilocode', 'KI'),
    executables: ['kilo', 'kilocode'],
    autoApproveArgs: ['--auto'],
    session: { latest: ['--continue'] },
    mcp: (endpoint) => ({ env: { KILO_CONFIG_CONTENT: opencodeConfigJson(endpoint) } })
  }),
  defineCli({
    id: 'vibe',
    displayName: 'Mistral Vibe',
    icon: officialIcon('vibe', 'VI'),
    executables: ['vibe']
  }),
  defineCli({
    id: 'grok',
    displayName: 'Grok CLI',
    icon: officialIcon('grok', 'GR'),
    executables: ['grok'],
    autoApproveArgs: ['--always-approve'],
    session: { start: (id) => ['--session-id', id], resume: (id) => ['--resume', id] }
  }),
  defineCli({
    id: 'continue',
    displayName: 'Continue CLI',
    icon: officialIcon('continue', 'CO'),
    executables: ['cn']
  }),
  defineCli({
    id: 'openhands',
    displayName: 'OpenHands',
    icon: officialIcon('openhands', 'OP'),
    executables: ['openhands']
  }),
  defineCli({
    id: 'plandex',
    displayName: 'Plandex',
    icon: officialIcon('plandex', 'PL'),
    executables: ['plandex']
  }),
  defineCli({
    id: 'letta',
    displayName: 'Letta Code',
    icon: officialIcon('letta', 'LE'),
    executables: ['letta']
  }),
  defineCli({
    id: 'antigravity',
    displayName: 'Antigravity CLI',
    icon: officialIcon('antigravity', 'AG'),
    executables: ['agy'],
    autoApproveArgs: ['--dangerously-skip-permissions'],
    session: { latest: ['--continue'] }
  }),
  defineCli({
    id: 'junie',
    displayName: 'Junie CLI',
    icon: officialIcon('junie', 'JU'),
    executables: ['junie']
  })
]
