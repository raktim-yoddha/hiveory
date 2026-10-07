import type { IconReference, WaitingReason } from '@shared/domain'
import { GENERIC_WAITING_PATTERNS } from '../status/heuristics'
import { officialIcon } from './icons'
import { mcpServersJson, opencodeConfigJson } from './mcp-injection'
import type { CliAdapter, McpEndpoint, SkillFolders } from './types'

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
  /** Columns its TUI needs before the layout breaks (see CliAdapter.minColumns). */
  minColumns?: number
  autoApproveArgs?: string[]
  autoApproveEnv?: Record<string, string>
  waitingPatterns?: Array<{ pattern: RegExp; reason: WaitingReason }>
  /** How this CLI loads Hiveory's agent-tools MCP server, if it can. */
  mcp?: (endpoint: McpEndpoint) => { args?: string[]; env?: Record<string, string> }
  /** Agent Skills folders it reads (Settings › Skills). */
  skills?: SkillFolders
  /** How an agent gets its own conversation back after a restart (ADR 0014). */
  session?: {
    /** Hiveory chooses the session id up front (exact, per agent)… */
    start?: (id: string) => string[]
    resume?: (id: string) => string[]
    /** …or the CLI continues the folder's most recent session (used only for the folder's sole agent of that CLI). */
    latest?: string[]
    /** Resumes one session by the id in its history (the Sessions tab), when the CLI takes one. */
    byId?: (id: string) => string[]
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
  ...(spec.minColumns ? { minColumns: spec.minColumns } : {}),
  injectMcp: Boolean(spec.mcp),
  ...(spec.skills ? { skills: spec.skills } : {}),
  ...(spec.session?.start && spec.session.resume
    ? { adoptSession: (id: string) => ({ conversationId: id }) }
    : spec.session?.byId
      ? { adoptSession: (id: string) => ({ providerSessionId: id }) }
      : {}),
  buildLaunch: ({ instance, autoApprove, mcp, resume, soleOfCli }) => {
    const tools = mcp && spec.mcp ? spec.mcp(mcp) : {}
    const s = spec.session
    const session =
      s?.start && s.resume
        ? resume
          ? s.resume(instance.conversationId)
          : s.start(instance.conversationId)
        : resume && instance.providerSessionId && s?.byId
          ? s.byId(instance.providerSessionId)
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
    session: { latest: ['--resume', 'latest'], byId: (id) => ['--resume', id] },
    waitingPatterns: [{ pattern: /Allow execution|Apply this change\?|Waiting for user confirmation/i, reason: 'permission' }],
    skills: { dir: '.gemini/skills', shared: true }
  }),
  defineCli({
    id: 'opencode',
    displayName: 'OpenCode',
    icon: officialIcon('opencode', 'OP'),
    executables: ['opencode'],
    // Measured: its footer and prompt collapse into one-word columns below ~46 columns.
    minColumns: 50,
    // Full-screen TUI breaks in small panes; the mini interface reflows and replays history on resize.
    args: ['--mini', '--replay-limit', '100000'],
    autoApproveArgs: ['--auto'],
    session: { latest: ['--continue'] },
    mcp: (endpoint) => ({ env: { OPENCODE_CONFIG_CONTENT: opencodeConfigJson(endpoint) } }),
    waitingPatterns: [{ pattern: /Permission required/i, reason: 'permission' }],
    skills: { dir: '.config/opencode/skills', projectDir: '.opencode/skills', shared: true, alsoReads: ['.claude/skills'] }
  }),
  defineCli({
    id: 'copilot',
    displayName: 'GitHub Copilot CLI',
    icon: officialIcon('copilot', 'CO'),
    executables: ['copilot'],
    autoApproveArgs: ['--allow-all-tools'],
    session: { latest: ['--continue'] },
    mcp: (endpoint) => ({ args: ['--additional-mcp-config', JSON.stringify(mcpServersJson(endpoint, { tools: ['*'] }))] }),
    skills: { dir: '.copilot/skills', projectDir: '.github/skills', shared: true, alsoReads: ['.claude/skills'] }
  }),
  defineCli({
    id: 'cursor',
    displayName: 'Cursor CLI',
    icon: officialIcon('cursor', 'CU'),
    executables: ['cursor-agent'],
    autoApproveArgs: ['--force'],
    session: { latest: ['resume'] },
    skills: { dir: '.cursor/skills', shared: true, alsoReads: ['.claude/skills', '.codex/skills'] }
  }),
  defineCli({
    id: 'qwen',
    displayName: 'Qwen Code',
    icon: officialIcon('qwen', 'QW'),
    executables: ['qwen'],
    autoApproveArgs: ['--yolo'],
    session: { latest: ['--continue'] },
    skills: { dir: '.qwen/skills', shared: true }
  }),
  defineCli({
    id: 'amp',
    displayName: 'Amp',
    icon: officialIcon('amp', 'AM'),
    executables: ['amp'],
    autoApproveArgs: ['--dangerously-allow-all'],
    skills: { dir: '.config/agents/skills', projectDir: null, shared: true }
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
    session: { latest: ['--resume'] },
    skills: { dir: '.config/goose/skills', projectDir: '.goose/skills', shared: true }
  }),
  defineCli({
    id: 'crush',
    displayName: 'Crush',
    icon: officialIcon('crush', 'CR'),
    executables: ['crush'],
    autoApproveArgs: ['--yolo'],
    skills: { dir: '.config/crush/skills', projectDir: '.crush/skills' }
  }),
  defineCli({
    id: 'kimi',
    displayName: 'Kimi CLI',
    icon: officialIcon('kimi', 'KI'),
    executables: ['kimi'],
    // Measured: its welcome box and tips wrap into a narrow side column below ~46 columns.
    minColumns: 50,
    autoApproveArgs: ['--yolo'],
    session: { latest: ['--continue'] },
    skills: { shared: true }
  }),
  defineCli({
    id: 'kiro',
    displayName: 'Kiro CLI',
    icon: officialIcon('kiro', 'KI'),
    executables: ['kiro-cli'],
    args: ['chat'],
    autoApproveArgs: ['--trust-all-tools'],
    skills: { dir: '.kiro/skills' }
  }),
  defineCli({
    id: 'droid',
    displayName: 'Factory Droid',
    icon: officialIcon('droid', 'DR'),
    executables: ['droid'],
    skills: { dir: '.factory/skills', shared: true }
  }),
  defineCli({
    id: 'auggie',
    displayName: 'Auggie',
    icon: officialIcon('auggie', 'AU'),
    executables: ['auggie'],
    skills: { dir: '.augment/skills' }
  }),
  defineCli({
    id: 'cline',
    displayName: 'Cline CLI',
    icon: officialIcon('cline', 'CL'),
    executables: ['cline'],
    skills: { shared: true }
  }),
  defineCli({
    id: 'kilocode',
    displayName: 'Kilo Code CLI',
    icon: officialIcon('kilocode', 'KI'),
    executables: ['kilo', 'kilocode'],
    // Measured: OpenCode's TUI underneath; its logo is cut and the footer collapses below ~46 columns.
    minColumns: 50,
    autoApproveArgs: ['--auto'],
    session: { latest: ['--continue'] },
    mcp: (endpoint) => ({ env: { KILO_CONFIG_CONTENT: opencodeConfigJson(endpoint) } }),
    skills: { dir: '.kilo/skills', shared: true, alsoReads: ['.claude/skills'] }
  }),
  defineCli({
    id: 'vibe',
    displayName: 'Mistral Vibe',
    icon: officialIcon('vibe', 'VI'),
    executables: ['vibe'],
    skills: { dir: '.vibe/skills' }
  }),
  defineCli({
    id: 'grok',
    displayName: 'Grok CLI',
    icon: officialIcon('grok', 'GR'),
    executables: ['grok'],
    autoApproveArgs: ['--always-approve'],
    session: { start: (id) => ['--session-id', id], resume: (id) => ['--resume', id] },
    skills: { dir: '.grok/skills' }
  }),
  defineCli({
    id: 'continue',
    displayName: 'Continue CLI',
    icon: officialIcon('continue', 'CO'),
    executables: ['cn'],
    skills: { dir: '.continue/skills' }
  }),
  defineCli({
    id: 'openhands',
    displayName: 'OpenHands',
    icon: officialIcon('openhands', 'OP'),
    executables: ['openhands'],
    skills: { dir: '.openhands/skills' }
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
    executables: ['letta'],
    skills: { shared: true }
  }),
  defineCli({
    id: 'antigravity',
    displayName: 'Antigravity CLI',
    icon: officialIcon('antigravity', 'AG'),
    executables: ['agy'],
    autoApproveArgs: ['--dangerously-skip-permissions'],
    session: { latest: ['--continue'] },
    skills: { dir: '.gemini/antigravity-cli/skills', projectDir: null, shared: true }
  }),
  defineCli({
    id: 'junie',
    displayName: 'Junie CLI',
    icon: officialIcon('junie', 'JU'),
    executables: ['junie'],
    skills: { dir: '.junie/skills' }
  }),
  // Round 7 market check (Emdash's 35 providers, OpenMausBot, Superset): CLIs they run that Hiveory did not.
  // Commands as their makers document them; no auto-approve or resume flag is assumed.
  defineCli({
    id: 'hermes',
    displayName: 'Hermes Agent',
    icon: officialIcon('hermes', 'HE'),
    executables: ['hermes']
  }),
  defineCli({
    id: 'devin',
    displayName: 'Devin CLI',
    icon: officialIcon('devin', 'DE'),
    executables: ['devin']
  }),
  defineCli({
    id: 'jules',
    displayName: 'Jules',
    icon: officialIcon('jules', 'JL'),
    executables: ['jules']
  }),
  defineCli({
    id: 'rovodev',
    displayName: 'Rovo Dev',
    icon: officialIcon('rovodev', 'RD'),
    // Atlassian's CLI; the interactive agent is its `rovodev run` subcommand.
    executables: ['acli'],
    args: ['rovodev', 'run']
  }),
  defineCli({
    id: 'codebuff',
    displayName: 'Codebuff',
    icon: officialIcon('codebuff', 'CB'),
    executables: ['codebuff']
  }),
  defineCli({
    id: 'codebuddy',
    displayName: 'CodeBuddy Code',
    icon: officialIcon('codebuddy', 'CB'),
    executables: ['codebuddy', 'cbc']
  }),
  defineCli({
    id: 'qoder',
    displayName: 'Qoder CLI',
    icon: officialIcon('qoder', 'QO'),
    executables: ['qodercli']
  }),
  defineCli({
    id: 'pi',
    displayName: 'Pi',
    icon: officialIcon('pi', 'PI'),
    executables: ['pi']
  }),
  defineCli({
    id: 'commandcode',
    displayName: 'Command Code',
    icon: officialIcon('commandcode', 'CC'),
    executables: ['command-code']
  }),
  defineCli({
    id: 'mimo',
    displayName: 'MiMo Code',
    icon: officialIcon('mimo', 'MI'),
    executables: ['mimo']
  }),
  defineCli({
    id: 'trae',
    displayName: 'Trae Agent',
    icon: officialIcon('trae', 'TR'),
    executables: ['trae-cli'],
    args: ['interactive']
  })
]
