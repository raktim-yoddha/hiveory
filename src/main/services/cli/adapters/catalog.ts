import type { IconReference, WaitingReason } from '@shared/domain'
import { GENERIC_WAITING_PATTERNS } from '../status/heuristics'
import { ICON_PATHS } from './icon-paths'
import type { CliAdapter } from './types'

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
}

/** Prompts most agent CLIs use when they need a decision. */
const COMMON_PROMPTS: NonNullable<CliSpec['waitingPatterns']> = [
  { pattern: /Do you want to (?:proceed|run|allow|apply|make|create|execute)/i, reason: 'permission' },
  { pattern: /Allow (?:once|always)|Approve (?:once|always)/i, reason: 'permission' },
  { pattern: /(?:Allow|Approve|Run) (?:this )?(?:command|execution|tool|edit)\?/i, reason: 'permission' }
]

const svg = (path: string, color: string): IconReference => ({ kind: 'svg', viewBox: '0 0 24 24', path, color })
const mono = (text: string, color: string): IconReference => ({ kind: 'monogram', text, color })

export const defineCli = (spec: CliSpec): CliAdapter => ({
  id: spec.id,
  displayName: spec.displayName,
  icon: spec.icon,
  executables: spec.executables,
  supportsAutoApprove: Boolean(spec.autoApproveArgs || spec.autoApproveEnv),
  buildLaunch: ({ autoApprove }) => ({
    args: [...(spec.args ?? []), ...(autoApprove ? (spec.autoApproveArgs ?? []) : [])],
    env: autoApprove ? spec.autoApproveEnv : undefined
  }),
  heuristics: () => ({
    waitingPatterns: [...(spec.waitingPatterns ?? []), ...COMMON_PROMPTS, ...GENERIC_WAITING_PATTERNS],
    workingOnSubmit: true,
    idleAfterSilenceMs: 4000
  })
})

/** Light marks are rendered in warm silver so black brand logos stay visible on dark surfaces. */
const SILVER = '#DCD6CC'

export const CATALOG: CliAdapter[] = [
  defineCli({
    id: 'gemini',
    displayName: 'Gemini CLI',
    icon: svg(
      'M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81',
      '#8E75B2'
    ),
    executables: ['gemini'],
    autoApproveArgs: ['--yolo'],
    waitingPatterns: [{ pattern: /Allow execution|Apply this change\?|Waiting for user confirmation/i, reason: 'permission' }]
  }),
  defineCli({
    id: 'opencode',
    displayName: 'OpenCode',
    icon: svg('M22 24H2V0h20zM17 4.8H7v14.4h10z', SILVER),
    executables: ['opencode'],
    waitingPatterns: [{ pattern: /Permission required/i, reason: 'permission' }]
  }),
  defineCli({
    id: 'copilot',
    displayName: 'GitHub Copilot CLI',
    icon: svg(ICON_PATHS.githubcopilot, SILVER),
    executables: ['copilot'],
    autoApproveArgs: ['--allow-all-tools']
  }),
  defineCli({
    id: 'cursor',
    displayName: 'Cursor CLI',
    icon: svg(ICON_PATHS.cursor, SILVER),
    executables: ['cursor-agent'],
    autoApproveArgs: ['--force']
  }),
  defineCli({
    id: 'qwen',
    displayName: 'Qwen Code',
    icon: svg(ICON_PATHS.qwen, '#8B78F2'),
    executables: ['qwen'],
    autoApproveArgs: ['--yolo']
  }),
  defineCli({
    id: 'amp',
    displayName: 'Amp',
    icon: mono('A', '#F25C3C'),
    executables: ['amp'],
    autoApproveArgs: ['--dangerously-allow-all']
  }),
  defineCli({
    id: 'aider',
    displayName: 'Aider',
    icon: mono('ai', '#4FBF73'),
    executables: ['aider'],
    autoApproveArgs: ['--yes-always']
  }),
  defineCli({
    id: 'goose',
    displayName: 'Goose',
    icon: mono('G', '#C9B28A'),
    executables: ['goose'],
    args: ['session'],
    autoApproveEnv: { GOOSE_MODE: 'auto' }
  }),
  defineCli({
    id: 'crush',
    displayName: 'Crush',
    icon: mono('C', '#D86BC4'),
    executables: ['crush'],
    autoApproveArgs: ['--yolo']
  }),
  defineCli({
    id: 'kimi',
    displayName: 'Kimi CLI',
    icon: svg(ICON_PATHS.kimi, SILVER),
    executables: ['kimi'],
    autoApproveArgs: ['--yolo']
  }),
  defineCli({
    id: 'kiro',
    displayName: 'Kiro CLI',
    icon: mono('K', '#9B7BF0'),
    executables: ['kiro-cli'],
    args: ['chat'],
    autoApproveArgs: ['--trust-all-tools']
  }),
  defineCli({
    id: 'droid',
    displayName: 'Factory Droid',
    icon: mono('D', '#E8915A'),
    executables: ['droid']
  }),
  defineCli({
    id: 'auggie',
    displayName: 'Auggie',
    icon: mono('Au', '#5FB7A8'),
    executables: ['auggie']
  }),
  defineCli({
    id: 'cline',
    displayName: 'Cline CLI',
    icon: svg(ICON_PATHS.cline, SILVER),
    executables: ['cline']
  }),
  defineCli({
    id: 'kilocode',
    displayName: 'Kilo Code CLI',
    icon: mono('Ki', '#E8C547'),
    executables: ['kilocode', 'kilo']
  }),
  defineCli({
    id: 'vibe',
    displayName: 'Mistral Vibe',
    icon: svg(ICON_PATHS.mistralai, '#FA7A2F'),
    executables: ['vibe']
  }),
  defineCli({
    id: 'grok',
    displayName: 'Grok CLI',
    icon: mono('X', SILVER),
    executables: ['grok']
  }),
  defineCli({
    id: 'continue',
    displayName: 'Continue CLI',
    icon: mono('cn', '#7AA2F7'),
    executables: ['cn']
  }),
  defineCli({
    id: 'openhands',
    displayName: 'OpenHands',
    icon: mono('OH', '#E2B36B'),
    executables: ['openhands']
  }),
  defineCli({
    id: 'plandex',
    displayName: 'Plandex',
    icon: mono('P', '#6FC3DF'),
    executables: ['plandex']
  }),
  defineCli({
    id: 'letta',
    displayName: 'Letta Code',
    icon: mono('L', '#B8A4F5'),
    executables: ['letta']
  })
]
