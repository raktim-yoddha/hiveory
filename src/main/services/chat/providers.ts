import { randomUUID } from 'node:crypto'
import type { ChatModel } from '@shared/domain/chat'
import { claudeParser, codexParser, geminiParser, opencodeParser, plainParser, type LineParser } from './parsers'

export interface RunInput {
  prompt: string
  model?: string
  effort?: string
  /** The CLI's own session id from an earlier turn. */
  sessionId?: string
  autoApprove: boolean
}

export interface RunSpec {
  args: string[]
  /** Prompt delivered on stdin instead of argv. */
  stdin?: string
  /** Session id Hiveory chose up front (CLIs that accept one). */
  assignedSessionId?: string
}

/** Runs a CLI subcommand and returns stdout (used for model discovery). */
export type CatalogRunner = (args: string[]) => Promise<string>

export interface ChatProvider {
  cliId: string
  parser: () => LineParser
  /** True when the CLI resumes its own sessions; otherwise Hiveory replays a transcript. */
  resumable: boolean
  models(run: CatalogRunner): Promise<ChatModel[]>
  run(input: RunInput): RunSpec
}

const DEFAULT_MODEL: ChatModel = { id: '', label: 'Default', description: "Uses the CLI's configured model" }
const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

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

const flag = (name: string, value?: string): string[] => (value ? [name, value] : [])

/** A prompt passed as an argument must never be mistaken for a flag. */
export const promptArg = (prompt: string): string => (prompt.startsWith('-') ? ` ${prompt}` : prompt)

const claude: ChatProvider = {
  cliId: 'claude',
  parser: claudeParser,
  resumable: true,
  models: async () => [
    { ...DEFAULT_MODEL, efforts: CLAUDE_EFFORTS },
    { id: 'opus', label: 'Opus', efforts: CLAUDE_EFFORTS, description: 'Most capable' },
    { id: 'sonnet', label: 'Sonnet', efforts: CLAUDE_EFFORTS, description: 'Balanced' },
    { id: 'haiku', label: 'Haiku', description: 'Fastest' }
  ],
  run: ({ prompt, model, effort, sessionId, autoApprove }) => {
    const assigned = sessionId ? undefined : randomUUID()
    return {
      args: [
        '-p',
        '--output-format',
        'stream-json',
        '--verbose',
        '--include-partial-messages',
        ...flag('--model', model),
        ...flag('--effort', effort),
        ...(sessionId ? ['--resume', sessionId] : ['--session-id', assigned as string]),
        ...(autoApprove ? ['--dangerously-skip-permissions'] : [])
      ],
      stdin: prompt,
      assignedSessionId: assigned
    }
  }
}

const codex: ChatProvider = {
  cliId: 'codex',
  parser: codexParser,
  resumable: true,
  models: async (run) => [DEFAULT_MODEL, ...parseCodexModels(await run(['debug', 'models']))],
  run: ({ prompt, model, effort, sessionId, autoApprove }) => {
    const options = [
      ...flag('-m', model),
      ...(effort ? ['-c', `model_reasoning_effort="${effort}"`] : []),
      ...(autoApprove ? ['--dangerously-bypass-approvals-and-sandbox'] : [])
    ]
    return {
      args: ['exec', '--json', '--skip-git-repo-check', ...options, ...(sessionId ? ['resume', sessionId] : []), '-'],
      stdin: prompt
    }
  }
}

const opencodeLike = (cliId: string): ChatProvider => ({
  cliId,
  parser: opencodeParser,
  resumable: true,
  models: async (run) => [DEFAULT_MODEL, ...parseOpencodeModels(await run(['models', '--verbose']))],
  run: ({ prompt, model, effort, sessionId, autoApprove }) => ({
    args: [
      'run',
      '--format',
      'json',
      ...flag('-m', model),
      ...flag('--variant', effort),
      ...flag('-s', sessionId),
      ...(autoApprove ? ['--auto'] : []),
      promptArg(prompt)
    ]
  })
})

const geminiLike = (cliId: string, models: ChatModel[]): ChatProvider => ({
  cliId,
  parser: geminiParser,
  resumable: false,
  models: async () => models,
  run: ({ prompt, model, autoApprove }) => ({
    args: ['-p', promptArg(prompt), '--output-format', 'stream-json', ...flag('-m', model), ...(autoApprove ? ['--yolo'] : [])]
  })
})

const grok: ChatProvider = {
  cliId: 'grok',
  parser: claudeParser,
  resumable: true,
  models: async () => [DEFAULT_MODEL],
  run: ({ prompt, model, sessionId, autoApprove }) => {
    const assigned = sessionId ? undefined : randomUUID()
    return {
      args: [
        '-p',
        promptArg(prompt),
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
  run: ({ prompt, model, autoApprove }) => ({
    args: ['-p', promptArg(prompt), '--output-format', 'stream-json', ...flag('-m', model), ...(autoApprove ? ['--yolo'] : [])]
  })
}

const cursor: ChatProvider = {
  cliId: 'cursor',
  parser: claudeParser,
  resumable: true,
  models: async () => [DEFAULT_MODEL],
  run: ({ prompt, model, sessionId, autoApprove }) => ({
    args: ['-p', promptArg(prompt), '--output-format', 'stream-json', ...flag('--model', model), ...flag('--resume', sessionId), ...(autoApprove ? ['--force'] : [])]
  })
}

const copilot: ChatProvider = {
  cliId: 'copilot',
  parser: plainParser,
  resumable: false,
  models: async () => [DEFAULT_MODEL],
  run: ({ prompt, model, autoApprove }) => ({ args: ['-p', promptArg(prompt), ...flag('--model', model), ...(autoApprove ? ['--allow-all-tools'] : [])] })
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
