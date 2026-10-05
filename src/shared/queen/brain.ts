import { z } from 'zod'
import { MAX_OPEN_PER_COMMAND, QUEEN_SETTINGS_SECTIONS, type QueenAction, type QueenContext, type QueenParse } from './actions'

/**
 * Tier 1 of Queen Bee (ADR 0019): a model plans what the rule parser could not.
 * The model only fills one tool call; this module defines that tool, the prompt,
 * and the strict, all-or-nothing validation of what comes back.
 */

export type BrainKind = 'openai' | 'anthropic' | 'gemini'

export interface BrainPreset {
  id: string
  name: string
  kind: BrainKind
  baseUrl: string
  model: string
  /** Local servers need no key. */
  keyRequired: boolean
}

/** Providers offered in Settings. Any other OpenAI-compatible endpoint uses "custom". */
export const BRAIN_PRESETS: BrainPreset[] = [
  { id: 'openai', name: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5-mini', keyRequired: true },
  { id: 'anthropic', name: 'Anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-haiku-4-5', keyRequired: true },
  { id: 'gemini', name: 'Google AI Studio', kind: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-flash-latest', keyRequired: true },
  { id: 'openrouter', name: 'OpenRouter', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-5-mini', keyRequired: true },
  { id: 'groq', name: 'Groq', kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b', keyRequired: true },
  { id: 'cerebras', name: 'Cerebras', kind: 'openai', baseUrl: 'https://api.cerebras.ai/v1', model: 'gpt-oss-120b', keyRequired: true },
  { id: 'xai', name: 'xAI', kind: 'openai', baseUrl: 'https://api.x.ai/v1', model: 'grok-4-fast', keyRequired: true },
  { id: 'ollama', name: 'Ollama (local)', kind: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'qwen3:8b', keyRequired: false },
  { id: 'lmstudio', name: 'LM Studio (local)', kind: 'openai', baseUrl: 'http://localhost:1234/v1', model: '', keyRequired: false },
  { id: 'custom', name: 'Custom (OpenAI-compatible)', kind: 'openai', baseUrl: '', model: '', keyRequired: false }
]

/**
 * One saved provider account. Several per provider are allowed (work and personal
 * keys, two local servers…). Queen Bee tries enabled accounts in order: the first
 * is primary, the rest are fallbacks when it fails.
 */
export interface BrainAccountView {
  id: string
  provider: string
  /** "Work", "Personal"… shown after the provider name. */
  label: string
  /** The wire format: fixed for known providers, chosen for custom ones. */
  kind: BrainKind
  baseUrl: string
  model: string
  enabled: boolean
  /** Never the key itself. */
  hasKey: boolean
  /** Whether the OS keychain protects saved keys (false: obfuscated only). */
  encrypted: boolean
}

export const presetOf = (provider: string): BrainPreset => BRAIN_PRESETS.find((p) => p.id === provider) ?? BRAIN_PRESETS.find((p) => p.id === 'custom')!

/** "OpenAI · Work", or just "OpenAI". */
export const accountName = (a: Pick<BrainAccountView, 'provider' | 'label'>): string => {
  const base = presetOf(a.provider).id === 'custom' ? 'Custom' : presetOf(a.provider).name
  return a.label ? `${base} · ${a.label}` : base
}

/** https everywhere, plain http only to this machine. */
export const isAllowedBrainUrl = (url: string): boolean => {
  try {
    const u = new URL(url)
    if (u.username || u.password) return false
    if (u.protocol === 'https:') return true
    return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
  } catch {
    return false
  }
}

const ACTION_TYPES = [
  'open-agents',
  'close-agents',
  'restart-agent',
  'focus-agent',
  'message-agent',
  'apply-preset',
  'navigate',
  'set-mode',
  'side-panel',
  'open-panel-tab',
  'report'
] as const

/** The one tool the model must call. Flat on purpose: every provider (Gemini included) accepts it. */
export const PLAN_TOOL = {
  name: 'plan',
  description: 'Plan the Hiveory actions for the request. Call exactly once.',
  parameters: {
    type: 'object',
    properties: {
      actions: {
        type: 'array',
        description: 'Actions to run in order. Empty when asking a question or replying.',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: [...ACTION_TYPES] },
            cliId: { type: 'string', description: 'open-agents: a CLI id from STATE.' },
            count: { type: 'integer', description: `open-agents: 1-${MAX_OPEN_PER_COMMAND}.` },
            workspaceId: { type: 'string', description: 'A workspace id from STATE.' },
            projectId: { type: 'string', description: 'A project id from STATE.' },
            agentId: { type: 'string', description: 'An agent id from STATE.' },
            agentIds: { type: 'array', items: { type: 'string' }, description: 'close-agents: agent ids from STATE.' },
            presetId: { type: 'string', description: 'apply-preset: a preset id from STATE.' },
            text: { type: 'string', description: 'message-agent: the exact message to send.' },
            to: { type: 'string', enum: ['home', 'settings', 'project', 'workspace'], description: 'navigate: destination.' },
            section: { type: 'string', enum: [...QUEEN_SETTINGS_SECTIONS], description: 'navigate to settings: section.' },
            mode: { type: 'string', enum: ['workspace', 'chatspace'], description: 'set-mode: workspace = Work, chatspace = Chat.' },
            open: { type: 'boolean', description: 'side-panel: true to show, false to hide.' },
            kind: { type: 'string', enum: ['browser', 'explorer'], description: 'open-panel-tab.' },
            focus: { type: 'string', enum: ['all', 'idle', 'working', 'waiting-for-you'], description: 'report: which agents.' }
          },
          required: ['type']
        }
      },
      question: { type: 'string', description: 'Ask this (one short sentence) instead of acting when the request is ambiguous or names something not in STATE.' },
      reply: { type: 'string', description: 'One short sentence when no action fits (e.g. the request is outside Hiveory).' }
    },
    required: ['actions']
  }
} as const

const id = z.string().min(1).max(200)
const actionSchema: z.ZodType<QueenAction> = z.union([
  z.object({ type: z.literal('open-agents'), cliId: id, count: z.number().int().min(1).max(MAX_OPEN_PER_COMMAND), workspaceId: id, projectId: id }),
  z.object({ type: z.literal('close-agents'), agentIds: z.array(id).min(1).max(50) }),
  z.object({ type: z.literal('restart-agent'), agentId: id }),
  z.object({ type: z.literal('focus-agent'), agentId: id, workspaceId: id, projectId: id }),
  z.object({ type: z.literal('message-agent'), agentId: id, text: z.string().trim().min(1).max(20_000) }),
  z.object({ type: z.literal('apply-preset'), presetId: id, workspaceId: id, projectId: id }),
  z.object({ type: z.literal('navigate'), to: z.literal('home') }),
  z.object({ type: z.literal('navigate'), to: z.literal('settings'), section: z.enum(QUEEN_SETTINGS_SECTIONS) }),
  z.object({ type: z.literal('navigate'), to: z.literal('project'), projectId: id }),
  z.object({ type: z.literal('navigate'), to: z.literal('workspace'), projectId: id, workspaceId: id }),
  z.object({ type: z.literal('set-mode'), mode: z.enum(['workspace', 'chatspace']) }),
  z.object({ type: z.literal('side-panel'), open: z.boolean() }),
  z.object({ type: z.literal('open-panel-tab'), kind: z.enum(['browser', 'explorer']) }),
  z.object({ type: z.literal('report'), focus: z.enum(['all', 'idle', 'working', 'waiting-for-you']) })
])

export type BrainResult = QueenParse | { kind: 'reply'; text: string }

const sentence = (text: unknown): string | null => (typeof text === 'string' && text.trim() ? text.trim().slice(0, 400) : null)

/**
 * Validates the model's tool arguments against the closed action set and the
 * live state it was shown. All or nothing: one bad action means nothing runs.
 */
export function planFromToolArgs(args: unknown, ctx: QueenContext): BrainResult {
  const raw = (typeof args === 'object' && args !== null ? args : {}) as Record<string, unknown>
  const question = sentence(raw.question)
  const reply = sentence(raw.reply)
  const list = Array.isArray(raw.actions) ? raw.actions : []
  if (!list.length) {
    if (question) return { kind: 'ask', question: { text: question } }
    return reply ? { kind: 'reply', text: reply } : { kind: 'unknown' }
  }
  if (list.length > 12) return { kind: 'unknown' }

  const actions: QueenAction[] = []
  const known = {
    cli: new Set(ctx.clis.map((c) => c.id)),
    workspace: new Set(ctx.workspaces.map((w) => w.id)),
    project: new Set(ctx.projects.map((p) => p.id)),
    agent: new Set(ctx.agents.map((a) => a.id)),
    preset: new Set(ctx.presets.map((p) => p.id))
  }
  for (const item of list) {
    // Providers send unused optional fields as "" or null: drop them before the strict parse.
    const cleaned = Object.fromEntries(Object.entries((item ?? {}) as Record<string, unknown>).filter(([, v]) => v !== '' && v !== null && v !== undefined))
    const parsed = actionSchema.safeParse(cleaned)
    if (!parsed.success) return { kind: 'unknown' }
    const a = parsed.data
    // Every id must be one the model was shown.
    const ok =
      ('cliId' in a ? known.cli.has(a.cliId) : true) &&
      ('workspaceId' in a ? known.workspace.has(a.workspaceId) : true) &&
      ('projectId' in a ? known.project.has(a.projectId) : true) &&
      ('agentId' in a ? known.agent.has(a.agentId) : true) &&
      ('agentIds' in a ? a.agentIds.every((x) => known.agent.has(x)) : true) &&
      ('presetId' in a ? known.preset.has(a.presetId) : true)
    if (!ok) return { kind: 'unknown' }
    actions.push(a)
  }
  const total = actions.reduce((n, a) => n + (a.type === 'open-agents' ? a.count : 0), 0)
  if (total > MAX_OPEN_PER_COMMAND) return { kind: 'ask', question: { text: `That's ${total} agents. I open at most ${MAX_OPEN_PER_COMMAND} per command.` } }

  // A model wrote these: anything that closes agents or types into one needs a yes.
  const name = (agentId: string) => ctx.agents.find((x) => x.id === agentId)?.petName ?? agentId
  const confirms = actions.flatMap((a) =>
    a.type === 'close-agents'
      ? [`Close ${a.agentIds.map(name).join(', ')}?`]
      : a.type === 'message-agent'
        ? [`Send to ${name(a.agentId)}: “${a.text.length > 160 ? `${a.text.slice(0, 160)}…` : a.text}”?`]
        : []
  )
  return confirms.length ? { kind: 'actions', actions, confirm: confirms.join(' ') } : { kind: 'actions', actions }
}

const STATUS_WORD: Record<string, string> = { idle: 'idle', working: 'working', 'waiting-for-you': 'waiting for you' }

/** The fixed part of every request: identical bytes each time, so providers can cache it. */
export function systemPrompt(persona: { name: string; tagline: string }): string {
  return [
    'You are Queen Bee, the operator inside Hiveory, a desktop app that runs coding-agent CLIs in panes.',
    'You never write code and never answer general questions. You only turn the request into Hiveory actions by calling the `plan` tool exactly once.',
    '',
    'Actions (run in order):',
    '- open-agents {cliId, count, workspaceId, projectId}: start agents of a CLI in a workspace.',
    '- close-agents {agentIds}: stop and close agents.',
    '- restart-agent {agentId}.',
    '- focus-agent {agentId, workspaceId, projectId}: show that agent\'s pane.',
    '- message-agent {agentId, text}: type a message (an instruction) into an agent. Keep the user\'s words; do not add your own.',
    '- apply-preset {presetId, workspaceId, projectId}.',
    '- navigate {to: home | settings (+section) | project (+projectId) | workspace (+projectId, workspaceId)}.',
    '- set-mode {mode: workspace (Work) | chatspace (Chat)}.',
    '- side-panel {open}; open-panel-tab {kind: browser | explorer}.',
    '- report {focus}: status of agents.',
    '',
    'Rules:',
    '- Use only ids that appear in STATE. Never invent or guess an id.',
    '- When no workspace is named, use the current one.',
    '- If anything is ambiguous or not in STATE, return no actions and set `question`.',
    '- If the request is outside Hiveory, return no actions and set `reply` to one sentence about what you can do.',
    `- Write \`question\` and \`reply\` as ${persona.name} (${persona.tagline.toLowerCase()}), in one short sentence.`
  ].join('\n')
}

/** The per-request part: a compact snapshot of what exists right now, then the request. */
export function stateMessage(ctx: QueenContext, utterance: string): string {
  const ws = ctx.workspaces.find((w) => w.id === ctx.workspaceId)
  const project = ctx.projects.find((p) => p.id === ctx.projectId)
  const page = ws ? `workspace ${ws.name} (${ws.id}) in project ${project?.name} (${project?.id})` : project ? `project ${project.name} (${project.id})` : 'home'
  const lines = [
    'STATE',
    `page: ${page}; mode: ${ctx.mode === 'chatspace' ? 'Chat' : 'Work'}`,
    `projects: ${ctx.projects.map((p) => `${p.id} ${p.name}`).join('; ') || 'none'}`,
    `workspaces: ${ctx.workspaces.map((w) => `${w.id} ${w.name}${w.kind === 'main' ? ' [main]' : ''}`).join('; ') || 'none'}`,
    `agents: ${ctx.agents.map((a) => `${a.id} ${a.petName} (cli ${a.cliId}, workspace ${a.workspaceId}${a.status ? `, ${STATUS_WORD[a.status]}` : ''})`).join('; ') || 'none'}`,
    `clis: ${ctx.clis.map((c) => `${c.id} = ${c.displayName}`).join('; ') || 'none'}`,
    `presets: ${ctx.presets.map((p) => `${p.id} ${p.name}`).join('; ') || 'none'}`,
    '',
    'REQUEST',
    utterance.slice(0, 2000)
  ]
  return lines.join('\n')
}
