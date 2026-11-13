import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import type { ChatAttachment, ChatCommand, ChatModel, UsageLimits, UsageWindow } from '@shared/domain/chat'
import { ALLOW_ALL_PERMISSIONS, claudeMcpArgs, codexMcpArgs, mcpServersJson, opencodeConfigJson } from '../cli/adapters/mcp-injection'
import type { McpEndpoint } from '../cli/adapters/types'
import { CLAUDE_CONTROL_ARGS, claudeControl, claudeControlReply } from './cli-probe'
import { claudeParser, codexParser, geminiParser, opencodeParser, plainParser, type LineParser } from './parsers'
import { APPROVAL_TOOL_FULL, APPROVAL_WAIT_MS } from './approvals'

export interface RunInput {
  prompt: string
  model?: string
  effort?: string
  /** The CLI's own session id from an earlier turn. */
  sessionId?: string
  autoApprove: boolean
  /** Files sent with this turn (by path). */
  attachments?: ChatAttachment[]
  /** Hiveory's MCP server (browser, and coordination for Work agents), when tools are on. */
  mcp?: ChatMcp
  /** Plan mode (providers with `plan`): read-only planning, whatever autoApprove says (ADR 0058). */
  plan?: boolean
  /** Fast mode, for a model marked `fast`. */
  fast?: boolean
}

export interface ChatMcp {
  endpoint: McpEndpoint
  /** Where a CLI that reads its MCP config from a file gets it written. */
  configPath: string
  /** Work agents also get the agent-coordination tools; plain chats only the browser. */
  coordination: boolean
}

export interface RunSpec {
  args: string[]
  /** Prompt delivered on stdin instead of argv. */
  stdin?: string
  /** Session id Hiveory chose up front (CLIs that accept one). */
  assignedSessionId?: string
  env?: Record<string, string>
  /** Written before the run (e.g. an MCP config holding the token, kept off the command line). */
  files?: Array<{ path: string; content: string }>
}

/** How a provider reaches its CLI for discovery: run a subcommand for its stdout, or ask over JSON lines (`probeCli`). */
export interface CatalogRunner {
  run(args: string[]): Promise<string>
  ask<T>(args: string[], messages: unknown[], answer: (message: Record<string, unknown>) => T | undefined): Promise<T>
}

export interface ChatProvider {
  cliId: string
  parser: () => LineParser
  /** True when the CLI resumes its own sessions; otherwise Hiveory replays a transcript. */
  resumable: boolean
  /** Its models, and, when the same answer lists them, its slash commands and skills (ADR 0058). */
  models(run: CatalogRunner): Promise<ChatModel[] | { models: ChatModel[]; commands: ChatCommand[] }>
  /** It has a read-only planning mode (`RunInput.plan`). */
  plan?: boolean
  /** Its permission requests, questions and plans reach Hiveory's approval tool (ADR 0073). */
  prompts?: boolean
  /** The plan's usage limits, asked of the CLI itself (ADR 0055); absent when the CLI cannot say. */
  limits?(run: CatalogRunner): Promise<PlanLimits>
  run(input: RunInput): RunSpec
}

export type PlanLimits = Pick<UsageLimits, 'windows' | 'plan' | 'note'>

const DEFAULT_MODEL: ChatModel = { id: '', label: 'Default', description: "Uses the CLI's configured model" }
const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
/** Claude's aliases, for when the CLI cannot list its own models. */
const CLAUDE_ALIASES: ChatModel[] = [
  { ...DEFAULT_MODEL, efforts: CLAUDE_EFFORTS },
  { id: 'opus', label: 'Opus', efforts: CLAUDE_EFFORTS, description: 'Most capable' },
  { id: 'sonnet', label: 'Sonnet', efforts: CLAUDE_EFFORTS, description: 'Balanced' },
  { id: 'haiku', label: 'Haiku', description: 'Fastest' }
]

/** "Opus 5.5" at the start of a description: a family and its version. */
const VERSIONED = /^[A-Z][\w-]* \d+(\.\d+)*\b/

/**
 * Claude Code's own model list (its `initialize` reply): each alias with the model it runs now, so the
 * picker says "Opus 5.5" or "Fable 5.1", not just "Opus". Prices are left out of the descriptions.
 */
export const parseClaudeModels = (models: unknown): ChatModel[] => {
  if (!Array.isArray(models)) return []
  return models.flatMap((raw): ChatModel[] => {
    const m = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
    if (typeof m.value !== 'string') return []
    const parts = (typeof m.description === 'string' ? m.description : '').split(' · ').filter((p) => p && !p.includes('$'))
    const efforts = m.supportsEffort === true && Array.isArray(m.supportedEffortLevels) ? m.supportedEffortLevels.filter((e): e is string => typeof e === 'string') : []
    if (m.value === 'default') {
      const current = /\(currently ([^)]+)\)/.exec(parts[0] ?? '')?.[1]
      return [{ ...DEFAULT_MODEL, label: current ? `Default (${current})` : 'Default', efforts }]
    }
    const version = VERSIONED.exec(parts[0] ?? '')?.[0]
    const name = typeof m.displayName === 'string' && m.displayName ? m.displayName : m.value
    return [{ id: m.value, label: version ?? name, description: (version ? parts.slice(1) : parts).join(' · ') || undefined, efforts }]
  })
}

/** Claude Code's `initialize` reply lists its slash commands and skills: [{ name, description, argumentHint }]. */
export const parseClaudeCommands = (commands: unknown): ChatCommand[] =>
  Array.isArray(commands)
    ? commands.flatMap((raw): ChatCommand[] => {
        const c = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
        if (typeof c.name !== 'string' || !c.name) return []
        return [
          {
            name: c.name.replace(/^\//, ''),
            ...(typeof c.description === 'string' && c.description ? { description: c.description } : {}),
            ...(typeof c.argumentHint === 'string' && c.argumentHint ? { argumentHint: c.argumentHint } : {})
          }
        ]
      })
    : []

/** Claude Code's fast mode runs on its Opus models only. */
const claudeFast = (model: ChatModel): ChatModel => (/opus/i.test(`${model.id} ${model.label}`) ? { ...model, fast: true } : model)

/** `codex debug models` → models with their own reasoning levels. */
export const parseCodexModels = (json: string): ChatModel[] => {
  const data = JSON.parse(json) as { models?: Array<Record<string, unknown>> }
  return (data.models ?? [])
    .filter((m) => m.visibility !== 'hide' && typeof m.slug === 'string')
    .map((m) => {
      const levels = Array.isArray(m.supported_reasoning_levels) ? m.supported_reasoning_levels : []
      return {
        id: m.slug as string,
        label: typeof m.display_name === 'string' ? m.display_name : (m.slug as string),
        description: typeof m.description === 'string' ? m.description : undefined,
        efforts: levels.map((l) => (l as { effort?: string }).effort).filter((e): e is string => Boolean(e)),
        defaultEffort: typeof m.default_reasoning_level === 'string' ? m.default_reasoning_level : undefined
      }
    })
}

/** `opencode models --verbose`: "provider/model" lines each followed by a JSON object. */
export const parseOpencodeModels = (text: string): ChatModel[] => {
  const models: ChatModel[] = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const header = lines[i]?.trim() ?? ''
    if (!/^[\w.@-]+\/\S+$/.test(header)) continue
    let depth = 0
    let body = ''
    let j = i + 1
    for (; j < lines.length; j++) {
      const line = lines[j] ?? ''
      if (depth === 0 && !line.trim().startsWith('{')) break
      body += line + '\n'
      depth += (line.match(/{/g) ?? []).length - (line.match(/}/g) ?? []).length
      if (depth <= 0) break
    }
    let meta: Record<string, unknown>
    try {
      meta = body ? (JSON.parse(body) as Record<string, unknown>) : {}
    } catch {
      meta = {}
    }
    const [provider] = header.split('/')
    const variants = meta.variants && typeof meta.variants === 'object' ? Object.keys(meta.variants as object) : []
    models.push({ id: header, label: typeof meta.name === 'string' ? meta.name : header.slice(header.indexOf('/') + 1), group: provider, efforts: variants })
    i = Math.max(i, j)
  }
  return models
}

const record = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {})
const percent = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : null)

/**
 * Claude Code's `get_usage` control reply: the claude.ai plan's 5-hour and weekly windows (each 0–100
 * with its reset), the per-model weekly ones, and the plan. API keys and cloud providers have none.
 */
export const parseClaudeUsage = (reply: Record<string, unknown>): PlanLimits => {
  const plan = typeof reply.subscription_type === 'string' ? reply.subscription_type : undefined
  const limits = reply.rate_limits_available === false ? null : reply.rate_limits
  if (!limits || typeof limits !== 'object') {
    return { windows: [], plan, note: 'Claude Code reports no plan limits for this sign-in: only a Claude subscription has 5-hour and weekly limits (an API key or a cloud provider has none).' }
  }
  const r = limits as Record<string, unknown>
  const windows: UsageWindow[] = []
  const add = (id: string, label: string, raw: unknown): void => {
    if (!raw || typeof raw !== 'object' || windows.some((w) => w.label === label)) return
    const w = record(raw)
    windows.push({ id, label, usedPercent: percent(w.utilization), ...(typeof w.resets_at === 'string' ? { resetsAt: w.resets_at } : {}) })
  }
  add('five_hour', '5-hour limit', r.five_hour)
  add('seven_day', 'Weekly · all models', r.seven_day)
  add('seven_day_opus', 'Weekly · Opus', r.seven_day_opus)
  add('seven_day_sonnet', 'Weekly · Sonnet', r.seven_day_sonnet)
  if (Array.isArray(r.model_scoped)) {
    for (const m of r.model_scoped) {
      const name = record(m).display_name
      if (typeof name === 'string' && name) add(`model:${name}`, `Weekly · ${name}`, m)
    }
  }
  return { windows, plan }
}

/** A window's length in words: 300 minutes is the "5-hour limit", 10 080 the "Weekly limit". */
const windowLabel = (minutes: unknown): string => {
  if (typeof minutes !== 'number' || minutes <= 0) return 'Limit'
  if (minutes === 7 * 24 * 60) return 'Weekly limit'
  if (minutes % (24 * 60) === 0) return `${minutes / (24 * 60)}-day limit`
  if (minutes % 60 === 0) return `${minutes / 60}-hour limit`
  return `${minutes}-minute limit`
}

/**
 * Codex app-server's `account/rateLimits/read` result: each metered bucket's primary and secondary
 * window (used percent, length in minutes, reset in epoch seconds), and the ChatGPT plan.
 */
export const parseCodexLimits = (result: Record<string, unknown>): PlanLimits => {
  const byId = Object.values(record(result.rateLimitsByLimitId)).filter((s) => s && typeof s === 'object')
  const snapshots = (byId.length ? byId : [result.rateLimits]).map(record)
  const windows: UsageWindow[] = []
  let plan: string | undefined
  for (const snap of snapshots) {
    if (typeof snap.planType === 'string') plan ??= snap.planType
    const prefix = byId.length > 1 && typeof snap.limitName === 'string' && snap.limitName ? `${snap.limitName} · ` : ''
    for (const key of ['primary', 'secondary'] as const) {
      const w = snap[key]
      if (!w || typeof w !== 'object') continue
      const { usedPercent, windowDurationMins, resetsAt } = record(w)
      windows.push({
        id: `${String(snap.limitId ?? 'codex')}:${key}`,
        label: prefix + windowLabel(windowDurationMins),
        usedPercent: percent(usedPercent),
        ...(typeof resetsAt === 'number' ? { resetsAt: new Date(resetsAt < 1e12 ? resetsAt * 1000 : resetsAt).toISOString() } : {})
      })
    }
  }
  return windows.length ? { windows, plan } : { windows, plan, note: 'Codex reports no plan limits for this sign-in.' }
}

const flag = (name: string, value?: string): string[] => (value ? [name, value] : [])

/** A prompt passed as an argument must never be mistaken for a flag. */
export const promptArg = (prompt: string): string => (prompt.startsWith('-') ? ` ${prompt}` : prompt)

/** Points the CLI at attached files; every agent CLI here can read a file by path. */
export const withAttachmentNote = (prompt: string, attachments: ChatAttachment[] = []): string =>
  attachments.length
    ? `${prompt || 'Look at the attached files.'}\n\nAttached files (read them as part of this message):\n${attachments.map((a) => `- ${a.path} (${a.kind})`).join('\n')}`
    : prompt

/** Folders holding attachments, for CLIs that limit file access to granted directories. */
const attachmentDirs = (attachments: ChatAttachment[] = []): string[] => [...new Set(attachments.map((a) => dirname(a.path)))]

const claude: ChatProvider = {
  cliId: 'claude',
  parser: claudeParser,
  resumable: true,
  // Asked of the CLI itself (no model call); the aliases still work when it cannot answer.
  plan: true,
  prompts: true,
  models: async (cli) => {
    const reply = await cli
      .ask(CLAUDE_CONTROL_ARGS, [claudeControl('models', { subtype: 'initialize' })], (m) => claudeControlReply(m, 'models'))
      .catch(() => ({}) as Record<string, unknown>)
    const models = parseClaudeModels(reply.models)
    return { models: (models.length ? models : CLAUDE_ALIASES).map(claudeFast), commands: parseClaudeCommands(reply.commands) }
  },
  limits: async (cli) =>
    parseClaudeUsage(await cli.ask(CLAUDE_CONTROL_ARGS, [claudeControl('usage', { subtype: 'get_usage', skip_behaviors: true })], (m) => claudeControlReply(m, 'usage'))),
  run: ({ prompt, model, effort, sessionId, autoApprove, attachments, mcp, plan, fast }) => {
    const assigned = sessionId ? undefined : randomUUID()
    return {
      ...(mcp ? { files: [{ path: mcp.configPath, content: JSON.stringify(mcpServersJson(mcp.endpoint)) }] } : {}),
      args: [
        '-p',
        '--output-format',
        'stream-json',
        '--verbose',
        '--include-partial-messages',
        ...flag('--model', model),
        ...flag('--effort', effort),
        ...(sessionId ? ['--resume', sessionId] : ['--session-id', assigned as string]),
        ...attachmentDirs(attachments).flatMap((dir) => ['--add-dir', dir]),
        // Plan mode wins over full access: it is the user's "think, don't touch" for this turn. An approved
        // plan then goes on with full access, which needs bypass made available up front (ADR 0073).
        ...(plan ? ['--permission-mode', 'plan', ...(autoApprove ? ['--allow-dangerously-skip-permissions'] : [])] : autoApprove ? ['--dangerously-skip-permissions'] : []),
        ...(fast && (!model || /opus/i.test(model)) ? ['--settings', JSON.stringify({ fastMode: true })] : []),
        ...(mcp ? claudeMcpArgs(mcp.endpoint, mcp.configPath, mcp.coordination) : []),
        // Permission requests, questions and plans become cards in the chat (ADR 0073).
        ...(mcp ? ['--permission-prompt-tool', APPROVAL_TOOL_FULL] : [])
      ],
      // A card may wait for the user for hours; the tool call must not time out first.
      ...(mcp ? { env: { MCP_TOOL_TIMEOUT: String(APPROVAL_WAIT_MS) } } : {}),
      stdin: withAttachmentNote(prompt, attachments),
      assignedSessionId: assigned
    }
  }
}

const codex: ChatProvider = {
  cliId: 'codex',
  parser: codexParser,
  resumable: true,
  models: async (cli) => [DEFAULT_MODEL, ...parseCodexModels(await cli.run(['debug', 'models']))],
  // The app-server answers from the ChatGPT sign-in Codex already has.
  limits: (cli) =>
    cli
      .ask(
        ['app-server'],
        [{ id: 1, method: 'initialize', params: { clientInfo: { name: 'hiveory', title: 'Hiveory', version: '1' } } }, { method: 'initialized' }, { id: 2, method: 'account/rateLimits/read' }],
        (m) => {
          if (m.id !== 2) return undefined
          if (m.error) throw new Error(String(record(m.error).message ?? 'Codex could not read its limits.'))
          return record(m.result)
        }
      )
      .then(parseCodexLimits)
      .catch((error: Error) => {
        if (/auth/i.test(error.message)) return { windows: [], note: 'Sign in to Codex with ChatGPT (codex login) to see your plan limits; an API key has none.' }
        throw error
      }),
  run: ({ prompt, model, effort, sessionId, autoApprove, attachments = [], mcp }) => {
    // Images go in natively; other files are read by path.
    const images = attachments.filter((a) => a.kind === 'image')
    const options = [
      ...(mcp ? codexMcpArgs(mcp.endpoint, mcp.coordination) : []),
      ...flag('-m', model),
      ...(effort ? ['-c', `model_reasoning_effort="${effort}"`] : []),
      ...(autoApprove ? ['--dangerously-bypass-approvals-and-sandbox'] : []),
      ...images.map((a) => `--image=${a.path}`)
    ]
    const others = attachments.filter((a) => a.kind !== 'image')
    return {
      args: ['exec', '--json', '--skip-git-repo-check', ...options, ...(sessionId ? ['resume', sessionId] : []), '-'],
      ...(mcp ? { env: { HIVEORY_MCP_TOKEN: mcp.endpoint.token } } : {}),
      stdin: withAttachmentNote(prompt || (images.length ? 'Look at the attached image.' : ''), others)
    }
  }
}

const opencodeLike = (cliId: string): ChatProvider => ({
  cliId,
  parser: opencodeParser,
  resumable: true,
  plan: true,
  models: async (cli) => [DEFAULT_MODEL, ...parseOpencodeModels(await cli.run(['models', '--verbose']))],
  run: ({ prompt, model, effort, sessionId, autoApprove, attachments = [], mcp, plan }) => ({
    env: {
      ...(mcp ? { [cliId === 'kilocode' ? 'KILO_CONFIG_CONTENT' : 'OPENCODE_CONFIG_CONTENT']: opencodeConfigJson(mcp.endpoint) } : {}),
      // Versions without --auto still honour the permission override (ADR 0049).
      ...(autoApprove && !plan ? { [cliId === 'kilocode' ? 'KILO_PERMISSION' : 'OPENCODE_PERMISSION']: ALLOW_ALL_PERMISSIONS } : {})
    },
    args: [
      'run',
      '--format',
      'json',
      ...flag('-m', model),
      ...flag('--variant', effort),
      ...flag('-s', sessionId),
      // Its built-in read-only "plan" agent.
      ...(plan ? ['--agent', 'plan'] : autoApprove ? ['--auto'] : []),
      promptArg(prompt || 'Look at the attached files.'),
      // Native attachments; last, because --file takes a list.
      ...attachments.map((a) => `--file=${a.path}`)
    ]
  })
})

const geminiLike = (cliId: string, models: ChatModel[]): ChatProvider => ({
  cliId,
  parser: geminiParser,
  resumable: false,
  models: async () => models,
  run: ({ prompt, model, autoApprove, attachments }) => ({
    args: [
      '-p',
      promptArg(withAttachmentNote(prompt, attachments)),
      '--output-format',
      'stream-json',
      ...flag('-m', model),
      ...attachmentDirs(attachments).flatMap((dir) => ['--include-directories', dir]),
      ...(autoApprove ? ['--yolo'] : [])
    ]
  })
})

const grok: ChatProvider = {
  cliId: 'grok',
  parser: claudeParser,
  resumable: true,
  models: async () => [DEFAULT_MODEL],
  run: ({ prompt, model, sessionId, autoApprove, attachments }) => {
    const assigned = sessionId ? undefined : randomUUID()
    return {
      args: [
        '-p',
        promptArg(withAttachmentNote(prompt, attachments)),
        '--output-format',
        'streaming-messages-json',
        '--include-partial-messages',
        ...flag('-m', model),
        ...(sessionId ? ['-r', sessionId] : ['-s', assigned as string]),
        ...(autoApprove ? ['--always-approve'] : [])
      ],
      assignedSessionId: assigned
    }
  }
}

const kimi: ChatProvider = {
  cliId: 'kimi',
  parser: claudeParser,
  resumable: false,
  models: async () => [DEFAULT_MODEL],
  run: ({ prompt, model, autoApprove, attachments }) => ({
    args: ['-p', promptArg(withAttachmentNote(prompt, attachments)), '--output-format', 'stream-json', ...flag('-m', model), ...(autoApprove ? ['--yolo'] : [])]
  })
}

const cursor: ChatProvider = {
  cliId: 'cursor',
  parser: claudeParser,
  resumable: true,
  models: async () => [DEFAULT_MODEL],
  run: ({ prompt, model, sessionId, autoApprove, attachments }) => ({
    args: ['-p', promptArg(withAttachmentNote(prompt, attachments)), '--output-format', 'stream-json', ...flag('--model', model), ...flag('--resume', sessionId), ...(autoApprove ? ['--force'] : [])]
  })
}

const copilot: ChatProvider = {
  cliId: 'copilot',
  parser: plainParser,
  resumable: false,
  models: async () => [DEFAULT_MODEL],
  run: ({ prompt, model, autoApprove, attachments, mcp }) => ({
    args: [
      '-p',
      promptArg(withAttachmentNote(prompt, attachments)),
      ...flag('--model', model),
      ...attachmentDirs(attachments).flatMap((dir) => ['--add-dir', dir]),
      ...(autoApprove ? ['--allow-all-tools'] : []),
      ...(mcp ? ['--additional-mcp-config', JSON.stringify(mcpServersJson(mcp.endpoint, { tools: ['*'] }))] : [])
    ]
  })
}

export const CHAT_PROVIDERS: Record<string, ChatProvider> = Object.fromEntries(
  [
    claude,
    codex,
    opencodeLike('opencode'),
    opencodeLike('kilocode'),
    geminiLike('gemini', [DEFAULT_MODEL, { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' }, { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' }]),
    geminiLike('qwen', [DEFAULT_MODEL]),
    grok,
    kimi,
    cursor,
    copilot
  ].map((p) => [p.cliId, p])
)

/** Prompt for CLIs that cannot resume: earlier turns replayed as plain context, newest last. */
export const transcriptPrompt = (history: Array<{ role: 'user' | 'assistant'; text: string }>, prompt: string, limit = 12000): string => {
  if (history.length === 0) return prompt
  const lines: string[] = []
  let size = 0
  for (const turn of [...history].reverse()) {
    const line = `${turn.role === 'user' ? 'User' : 'Assistant'}: ${turn.text}`
    if (size + line.length > limit) break
    lines.unshift(line)
    size += line.length
  }
  return `Conversation so far:\n${lines.join('\n\n')}\n\nUser: ${prompt}`
}
