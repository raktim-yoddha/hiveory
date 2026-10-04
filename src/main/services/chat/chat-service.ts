import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { CHAT_CLI_IDS, type ChatCatalog, type ChatMessage, type ChatSession, type ChatSummary } from '@shared/domain/chat'
import { fail } from '@shared/errors'
import type { Logger } from '../../app/logger'
import type { CliRegistry } from '../cli/registry'
import type { Emit } from '../events'
import { nowIso } from '../events'
import { sanitizeEnv } from '../pty/env'
import { resolveSpawnTarget } from '../pty/spawn-target'
import type { WorkspaceRepository } from '../workspaces/workspace-repository'
import { ChatAccumulator } from './accumulator'
import type { ChatStore } from './chat-store'
import { CHAT_PROVIDERS, transcriptPrompt } from './providers'

const CATALOG_TTL_MS = 10 * 60 * 1000
const EMIT_EVERY_MS = 50
const MAX_STDERR = 4000

interface Run {
  child: ChildProcess
  stopped: boolean
}

/**
 * Chats over any chat-capable CLI, run headless in main so a chat keeps
 * streaming while the user is in Work mode (or the window is hidden). The CLI
 * is locked once the first message is sent; model and effort may change per turn.
 */
export class ChatService {
  private readonly runs = new Map<string, Run>()
  private readonly catalogs = new Map<string, { at: number; catalog: Promise<ChatCatalog> }>()

  constructor(
    private readonly store: ChatStore,
    private readonly registry: CliRegistry,
    private readonly workspaces: WorkspaceRepository,
    private readonly log: Logger,
    private readonly emit: Emit
  ) {}

  /** Installed CLIs that can drive a chat (Antigravity is deliberately excluded). */
  clis(): string[] {
    const available = new Set(this.registry.list().filter((c) => c.available).map((c) => c.id))
    return CHAT_CLI_IDS.filter((id) => available.has(id))
  }

  list(): ChatSummary[] {
    return this.store
      .all()
      .map((c) => this.summary(c))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  get(chatId: string): ChatSession {
    const chat = this.store.get(chatId)
    if (!chat) fail('NOT_FOUND', 'Chat not found.')
    return chat!
  }

  create(projectId?: string): ChatSession {
    const now = nowIso()
    const cwd = projectId ? this.workspaces.project(projectId).path : homedir()
    const chat: ChatSession = { id: randomUUID(), title: 'New chat', projectId, cwd, autoApprove: false, messages: [], createdAt: now, updatedAt: now }
    this.store.save(chat)
    this.emit('state.changed', { topic: 'chats' })
    return chat
  }

  update(chatId: string, patch: Partial<Pick<ChatSession, 'cliId' | 'model' | 'effort' | 'autoApprove' | 'title' | 'projectId'>>): ChatSession {
    const chat = this.get(chatId)
    const started = chat.messages.length > 0
    if (patch.cliId !== undefined && patch.cliId !== chat.cliId) {
      if (started) fail('FORBIDDEN', 'The CLI is locked once a chat has started.', { hint: 'Start a new chat to use another CLI.' })
      if (!this.clis().includes(patch.cliId)) fail('CLI_UNAVAILABLE', 'That CLI is not available for chat.')
      // A different CLI means different models; reset the model-specific choices.
      chat.cliId = patch.cliId
      chat.model = undefined
      chat.effort = undefined
    }
    if (patch.projectId !== undefined && patch.projectId !== chat.projectId) {
      if (started) fail('FORBIDDEN', 'The folder is fixed once a chat has started.')
      chat.projectId = patch.projectId || undefined
      chat.cwd = chat.projectId ? this.workspaces.project(chat.projectId).path : homedir()
    }
    if ('model' in patch) chat.model = patch.model || undefined
    if ('effort' in patch) chat.effort = patch.effort || undefined
    if (patch.autoApprove !== undefined) chat.autoApprove = patch.autoApprove
    if (patch.title !== undefined) chat.title = patch.title.trim().slice(0, 80) || chat.title
    chat.updatedAt = nowIso()
    this.store.save(chat)
    this.emit('state.changed', { topic: 'chats' })
    return chat
  }

  delete(chatId: string): void {
    this.stop(chatId)
    this.store.delete(chatId)
    this.emit('state.changed', { topic: 'chats' })
  }

  catalog(cliId: string, refresh = false): Promise<ChatCatalog> {
    const cached = this.catalogs.get(cliId)
    if (cached && !refresh && Date.now() - cached.at < CATALOG_TTL_MS) return cached.catalog
    const provider = CHAT_PROVIDERS[cliId]
    const executable = this.registry.executable(cliId)
    if (!provider || !executable) return Promise.resolve({ cliId, models: [], error: 'This CLI is not available for chat.' })
    const run = (args: string[]): Promise<string> =>
      new Promise((resolve, reject) => {
        const target = resolveSpawnTarget(executable, args)
        execFile(target.file, target.args, { timeout: 30_000, windowsHide: true, maxBuffer: 32 * 1024 * 1024, env: sanitizeEnv(process.env) }, (error, stdout) =>
          error ? reject(error) : resolve(stdout.toString())
        )
      })
    const catalog = provider
      .models(run)
      .then((models) => ({ cliId, models }))
      .catch((error: Error) => {
        this.log.warn(`Model discovery failed for ${cliId}`, error)
        // Default model always works; discovery errors never block chatting.
        return { cliId, models: [{ id: '', label: 'Default', description: "Uses the CLI's configured model" }], error: 'Could not list models.' }
      })
    this.catalogs.set(cliId, { at: Date.now(), catalog })
    return catalog
  }

  send(chatId: string, text: string): void {
    const chat = this.get(chatId)
    const prompt = text.trim()
    if (!prompt) fail('INVALID_INPUT', 'Type a message first.')
    if (this.runs.has(chatId)) fail('INVALID_INPUT', 'This chat is still answering.', { hint: 'Wait for it or press Stop.' })
    if (!chat.cliId) fail('INVALID_INPUT', 'Choose a CLI first.')
    const provider = CHAT_PROVIDERS[chat.cliId!]
    const executable = this.registry.executable(chat.cliId!)
    if (!provider || !executable) fail('CLI_UNAVAILABLE', `${this.registry.displayName(chat.cliId!)} is not available.`)

    const history = chat.messages.map((m) => ({
      role: m.role,
      text: m.parts
        .filter((p) => p.kind === 'text')
        .map((p) => (p as { text: string }).text)
        .join('\n')
    }))
    const now = nowIso()
    chat.messages.push({ id: randomUUID(), role: 'user', parts: [{ kind: 'text', text: prompt }], createdAt: now })
    const reply: ChatMessage = { id: randomUUID(), role: 'assistant', parts: [], createdAt: now, streaming: true }
    chat.messages.push(reply)
    if (chat.title === 'New chat') chat.title = prompt.replace(/\s+/g, ' ').slice(0, 60)
    chat.updatedAt = now
    this.store.save(chat)

    const spec = provider!.run({
      prompt: provider!.resumable ? prompt : transcriptPrompt(history, prompt),
      model: chat.model,
      effort: chat.effort,
      sessionId: provider!.resumable ? chat.providerSessionId : undefined,
      autoApprove: chat.autoApprove
    })
    if (spec.assignedSessionId) chat.providerSessionId = spec.assignedSessionId

    const acc = new ChatAccumulator(reply)
    const parse = provider!.parser()
    let stderr = ''
    let lastEmit = 0
    let pending: NodeJS.Timeout | null = null
    const push = (force = false): void => {
      const elapsed = Date.now() - lastEmit
      if (!force && elapsed < EMIT_EVERY_MS) {
        pending ??= setTimeout(() => {
          pending = null
          push(true)
        }, EMIT_EVERY_MS - elapsed)
        return
      }
      lastEmit = Date.now()
      this.emit('chat.event', { chatId, message: structuredClone(reply), summary: this.summary(chat) })
    }

    let child: ChildProcess
    try {
      const target = resolveSpawnTarget(executable!, spec.args)
      child = spawn(target.file, target.args, { cwd: chat.cwd, env: sanitizeEnv(process.env), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (error) {
      this.finish(chat, reply, acc, error instanceof Error ? error.message : String(error))
      return
    }
    const run: Run = { child, stopped: false }
    this.runs.set(chatId, run)
    this.emit('state.changed', { topic: 'chats' })
    push(true)

    let buffer = ''
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      buffer += chunk
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          for (const event of parse(line)) acc.apply(event)
        } catch (error) {
          this.log.warn('Chat parse error', error)
        }
      }
      push()
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-MAX_STDERR)
    })
    child.on('error', (error) => {
      this.runs.delete(chatId)
      this.finish(chat, reply, acc, error.message)
    })
    child.on('close', (code) => {
      if (buffer.trim()) for (const event of parse(buffer)) acc.apply(event)
      if (pending) clearTimeout(pending)
      this.runs.delete(chatId)
      let error: string | undefined
      if (run.stopped) error = 'Stopped'
      else if (acc.errors.length) error = acc.errors.join('\n')
      else if (code !== 0 && !acc.text()) error = stderr.trim().split(/\r?\n/).slice(-6).join('\n') || `Exited with code ${code}`
      this.finish(chat, reply, acc, error)
    })
    if (spec.stdin !== undefined) {
      child.stdin?.on('error', () => undefined)
      child.stdin?.end(spec.stdin)
    } else {
      child.stdin?.end()
    }
  }

  stop(chatId: string): void {
    const run = this.runs.get(chatId)
    if (!run) return
    run.stopped = true
    killTree(run.child)
  }

  stopAll(): void {
    for (const id of [...this.runs.keys()]) this.stop(id)
  }

  isRunning(chatId: string): boolean {
    return this.runs.has(chatId)
  }

  private finish(chat: ChatSession, reply: ChatMessage, acc: ChatAccumulator, error?: string): void {
    if (acc.sessionId && !chat.providerSessionId) chat.providerSessionId = acc.sessionId
    reply.streaming = false
    if (error) reply.error = error
    else if (reply.parts.length === 0) reply.error = 'No response.'
    chat.updatedAt = nowIso()
    this.store.save(chat)
    this.emit('chat.event', { chatId: chat.id, message: structuredClone(reply), summary: this.summary(chat) })
    this.emit('state.changed', { topic: 'chats' })
  }

  private summary(chat: ChatSession): ChatSummary {
    return { id: chat.id, title: chat.title, cliId: chat.cliId, projectId: chat.projectId, updatedAt: chat.updatedAt, running: this.runs.has(chat.id) }
  }
}

/** Ends a process and its children (CLIs spawn helpers; Windows needs taskkill /T). */
const killTree = (child: ChildProcess): void => {
  if (!child.pid || child.exitCode !== null) return
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }, () => undefined)
  } else {
    try {
      child.kill('SIGTERM')
    } catch {
      // Already gone.
    }
  }
}
