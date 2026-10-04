import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import type { ChatAttachment, ChatModel } from '@shared/domain/chat'
import { claudeMcpArgs, codexMcpArgs, mcpServersJson, opencodeConfigJson } from '../cli/adapters/mcp-injection'
import type { McpEndpoint } from '../cli/adapters/types'
import { claudeParser, codexParser, geminiParser, opencodeParser, plainParser, type LineParser } from './parsers'

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
  models: async () => [
    { ...DEFAULT_MODEL, efforts: CLAUDE_EFFORTS },
    { id: 'opus', label: 'Opus', efforts: CLAUDE_EFFORTS, description: 'Most capable' },
    { id: 'sonnet', label: 'Sonnet', efforts: CLAUDE_EFFORTS, description: 'Balanced' },
    { id: 'haiku', label: 'Haiku', description: 'Fastest' }
  ],
  run: ({ prompt, model, effort, sessionId, autoApprove, attachments, mcp }) => {
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
        ...(autoApprove ? ['--dangerously-skip-permissions'] : []),
        ...(mcp ? claudeMcpArgs(mcp.endpoint, mcp.configPath, mcp.coordination) : [])
      ],
      stdin: withAttachmentNote(prompt, attachments),
      assignedSessionId: assigned
    }
  }
}

const codex: ChatProvider = {
  cliId: 'codex',
  parser: codexParser,
  resumable: true,
  models: async (run) => [DEFAULT_MODEL, ...parseCodexModels(await run(['debug', 'models']))],
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
  models: async (run) => [DEFAULT_MODEL, ...parseOpencodeModels(await run(['models', '--verbose']))],
  run: ({ prompt, model, effort, sessionId, autoApprove, attachments = [], mcp }) => ({
    ...(mcp ? { env: { [cliId === 'kilocode' ? 'KILO_CONFIG_CONTENT' : 'OPENCODE_CONFIG_CONTENT']: opencodeConfigJson(mcp.endpoint) } } : {}),
    args: [
      'run',
      '--format',
      'json',
      ...flag('-m', model),
      ...flag('--variant', effort),
      ...flag('-s', sessionId),
      ...(autoApprove ? ['--auto'] : []),
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
