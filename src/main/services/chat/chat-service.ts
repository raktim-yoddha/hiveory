import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { MAX_QUEUED } from '@shared/domain/prompt'
import { EventEmitter } from 'node:events'
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import type { CliInstance } from '@shared/domain'
import { CHAT_CLI_IDS, type ChatAttachment, type ChatCatalog, type ChatMessage, type ChatSession, type ChatSummary } from '@shared/domain/chat'
import { fail } from '@shared/errors'
import type { Logger } from '../../app/logger'
import type { McpEndpoint } from '../cli/adapters/types'
import type { CliRegistry } from '../cli/registry'
import type { Emit } from '../events'
import { nowIso } from '../events'
import { sanitizeEnv } from '../pty/env'
import { killTree, resolveSpawnTarget } from '../pty/spawn-target'
import type { WorkspaceRepository } from '../workspaces/workspace-repository'
import { ChatAccumulator } from './accumulator'
import type { ChatStore } from './chat-store'
import { CHAT_PROVIDERS, transcriptPrompt, type ChatMcp } from './providers'

const CATALOG_TTL_MS = 10 * 60 * 1000
const EMIT_EVERY_MS = 50
const MAX_STDERR = 4000
/** Files dropped from disk are sent by path; anything bigger than this is refused. */
const MAX_ATTACHMENT_BYTES = 200 * 1024 * 1024

const KIND_BY_EXT: Record<string, ChatAttachment['kind']> = {
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.gif': 'image', '.webp': 'image', '.bmp': 'image',
  '.mp4': 'video', '.mov': 'video', '.webm': 'video', '.mkv': 'video', '.avi': 'video',
  '.txt': 'text', '.md': 'text', '.log': 'text', '.csv': 'text', '.json': 'text'
}
const EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/bmp': '.bmp',
  'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm', 'text/plain': '.txt'
}

export const attachmentKind = (name: string): ChatAttachment['kind'] => KIND_BY_EXT[extname(name).toLowerCase()] ?? 'file'

/** A file name that is safe on every platform. */
const safeName = (name: string): string => basename(name).replace(/[^\w.() -]+/g, '_').slice(0, 120) || 'file'

interface Run {
  child: ChildProcess
  stopped: boolean
}

/**
 * Chats over any chat-capable CLI, run headless in main so a chat keeps
 * streaming while the user is in Work mode (or the window is hidden). The CLI
 * is locked once the first message is sent; model and effort may change per turn.
 * Work agents in chat view are backed by a chat with the agent's id (`agentId`).
 */
export class ChatService extends EventEmitter<{ run: [chatId: string, running: boolean] }> {
  private readonly runs = new Map<string, Run>()
  /** Attachment paths main created or the user picked, per chat; `send` accepts nothing else. */
  private readonly attachments = new Map<string, Set<string>>()
  private readonly catalogs = new Map<string, { at: number; catalog: Promise<ChatCatalog> }>()

  constructor(
    private readonly store: ChatStore,
    private readonly registry: CliRegistry,
    private readonly workspaces: WorkspaceRepository,
    private readonly log: Logger,
    private readonly broadcast: Emit,
    private readonly attachmentsDir: string,
    /** Hiveory's MCP endpoint for a chat (route id = chat id), or undefined when tools are off. */
    private readonly mcpFor: (chatId: string) => McpEndpoint | undefined = () => undefined,
    /** Per-run generated files (MCP configs). */
    private readonly runtimeDir = join(attachmentsDir, '..', '.runtime'),
    /** Text sent ahead of a conversation's first turn (a bot's identity, brief and memory). */
    private readonly preamble: (chat: ChatSession) => string | undefined = () => undefined
  ) {
    super()
  }

  /** Saves pasted data (a screenshot, a video, long text) as a file the CLI can read. */
  attach(chatId: string, name: string, mime: string, base64: string): ChatAttachment {
    this.get(chatId)
    const data = Buffer.from(base64, 'base64')
    const ext = extname(name) || EXT_BY_MIME[mime] || ''
    const fileName = `${randomUUID().slice(0, 8)}-${safeName(basename(name, extname(name)))}${ext}`
    const dir = join(this.attachmentsDir, chatId)
    mkdirSync(dir, { recursive: true })
    const path = join(dir, fileName)
    writeFileSync(path, data)
    return this.register(chatId, { name: safeName(name.endsWith(ext) ? name : name + ext), path, kind: attachmentKind(fileName), size: data.length })
  }

  /** Accepts a file the user dropped or pasted from disk; it is sent by path, never copied. */
  attachPath(chatId: string, path: string): ChatAttachment {
    this.get(chatId)
    let stat: ReturnType<typeof statSync>
    try {
      stat = statSync(path)
    } catch {
      return fail('NOT_FOUND', 'That file no longer exists.')
    }
    if (!stat.isFile()) fail('INVALID_INPUT', 'Only files can be attached.')
    const size = stat.size
    if (size > MAX_ATTACHMENT_BYTES) fail('INVALID_INPUT', 'That file is too large to attach (200 MB at most).')
    return this.register(chatId, { name: basename(path), path, kind: attachmentKind(path), size })
  }

  private register(chatId: string, attachment: ChatAttachment): ChatAttachment {
    const set = this.attachments.get(chatId) ?? new Set<string>()
    set.add(attachment.path)
    this.attachments.set(chatId, set)
    return attachment
  }

  /** Installed CLIs that can drive a chat (Antigravity is deliberately excluded). */
  clis(): string[] {
    const available = new Set(this.registry.list().filter((c) => c.available).map((c) => c.id))
    return CHAT_CLI_IDS.filter((id) => available.has(id))
  }

  list(): ChatSummary[] {
    return this.store
      .all()
      .filter((c) => !c.agentId && !c.botId)
      .map((c) => this.summary(c))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  /** A bot's threads, newest first. */
  threads(botId: string): ChatSummary[] {
    return this.store
      .all()
      .filter((c) => c.botId === botId)
      .map((c) => this.summary(c))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  /** A new thread for a bot: it works in the bot's folder, starting from the bot's engine and permissions. */
  createThread(input: Pick<ChatSession, 'botId' | 'cwd' | 'cliId' | 'model' | 'effort' | 'autoApprove' | 'delegation' | 'readOnly'> & { title?: string }): ChatSession {
    const now = nowIso()
    const cliId = input.cliId && this.clis().includes(input.cliId) ? input.cliId : undefined
    const chat: ChatSession = {
      id: randomUUID(),
      title: input.title?.trim().slice(0, 80) || 'New chat',
      botId: input.botId,
      cwd: input.cwd,
      cliId,
      model: cliId ? input.model : undefined,
      effort: cliId ? input.effort : undefined,
      autoApprove: input.autoApprove,
      ...(input.delegation ? { delegation: input.delegation } : {}),
      ...(input.readOnly ? { readOnly: true } : {}),
      messages: [],
      createdAt: now,
      updatedAt: now
    }
    this.store.save(chat)
    this.broadcast('state.changed', { topic: 'chats' })
    return chat
  }

  private mcpConfig(chat: ChatSession): ChatMcp | undefined {
    const endpoint = this.mcpFor(chat.id)
    if (!endpoint) return undefined
    return { endpoint, configPath: join(this.runtimeDir, `${chat.id}-mcp.json`), coordination: Boolean(chat.agentId) }
  }

  find(chatId: string): ChatSession | undefined {
    return this.store.get(chatId)
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
    this.broadcast('state.changed', { topic: 'chats' })
    return chat
  }

  /** The chat behind a Work agent in chat view. Its CLI and folder follow the agent and never change. */
  ensureAgentChat(instance: CliInstance, cwd: string): void {
    const existing = this.store.get(instance.id)
    if (existing) {
      if (existing.cwd !== cwd) this.store.save({ ...existing, cwd })
      return
    }
    const now = nowIso()
    this.store.save({
      id: instance.id,
      agentId: instance.id,
      title: instance.petName,
      projectId: instance.projectId,
      cwd,
      cliId: instance.cliId,
      autoApprove: instance.autoApprove,
      messages: [],
      createdAt: now,
      updatedAt: now
    })
  }

  update(chatId: string, patch: Partial<Pick<ChatSession, 'cliId' | 'model' | 'effort' | 'autoApprove' | 'title' | 'projectId'>>): ChatSession {
    const chat = this.get(chatId)
    if (chat.agentId && ((patch.cliId && patch.cliId !== chat.cliId) || patch.projectId !== undefined)) {
      fail('FORBIDDEN', "An agent's CLI and folder are fixed.")
    }
    if (chat.botId && patch.projectId !== undefined) fail('FORBIDDEN', "A bot's threads work in the bot's own folder.")
    if (chat.readOnly && patch.autoApprove) fail('FORBIDDEN', 'A trigger run stays read-only.', { hint: 'Start a new thread to give the bot full access.' })
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
    this.broadcast('state.changed', { topic: 'chats' })
    return chat
  }

  delete(chatId: string): void {
    this.stop(chatId)
    this.store.delete(chatId)
    this.attachments.delete(chatId)
    try {
      rmSync(join(this.attachmentsDir, chatId), { recursive: true, force: true })
    } catch {
      // Leftover attachment files are harmless.
    }
    this.broadcast('state.changed', { topic: 'chats' })
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

  send(chatId: string, text: string, attachments: ChatAttachment[] = []): void {
    const chat = this.get(chatId)
    const prompt = text.trim()
    if (!prompt && attachments.length === 0) fail('INVALID_INPUT', 'Type a message first.')
    const allowed = this.attachments.get(chatId)
    if (attachments.some((a) => !allowed?.has(a.path))) fail('INVALID_INPUT', 'Attach files again before sending.')
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
    chat.messages.push({
      id: randomUUID(),
      role: 'user',
      parts: prompt ? [{ kind: 'text', text: prompt }] : [],
      ...(attachments.length ? { attachments } : {}),
      createdAt: now
    })
    const reply: ChatMessage = { id: randomUUID(), role: 'assistant', parts: [], createdAt: now, streaming: true }
    chat.messages.push(reply)
    if (chat.title === 'New chat') chat.title = (prompt || attachments[0]!.name).replace(/\s+/g, ' ').slice(0, 60)
    chat.updatedAt = now
    this.store.save(chat)

    // A bot's identity goes ahead of its first turn; providers without resume get it every turn with the transcript.
    const intro = this.preamble(chat)
    const body = provider!.resumable ? prompt : transcriptPrompt(history, prompt)
    const firstTurn = !provider!.resumable || !chat.providerSessionId
    const spec = provider!.run({
      prompt: intro && firstTurn ? `${intro}\n\n---\n\n${body}` : body,
      model: chat.model,
      effort: chat.effort,
      sessionId: provider!.resumable ? chat.providerSessionId : undefined,
      autoApprove: chat.autoApprove,
      attachments,
      mcp: this.mcpConfig(chat)
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
      this.broadcast('chat.event', { chatId, message: structuredClone(reply), summary: this.summary(chat) })
    }

    let child: ChildProcess
    try {
      const target = resolveSpawnTarget(executable!, spec.args)
      for (const file of spec.files ?? []) {
        mkdirSync(dirname(file.path), { recursive: true })
        writeFileSync(file.path, file.content)
      }
      child = spawn(target.file, target.args, { cwd: chat.cwd, env: { ...sanitizeEnv(process.env), ...spec.env }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (error) {
      this.finish(chat, reply, acc, error instanceof Error ? error.message : String(error))
      return
    }
    const run: Run = { child, stopped: false }
    this.runs.set(chatId, run)
    this.broadcast('state.changed', { topic: 'chats' })
    this.emit('run', chatId, true)
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

  /** Sends now, or, while the chat is still answering, lines it up as the next turn (ADR 0031). */
  enqueue(chatId: string, text: string): void {
    if (!this.runs.has(chatId)) return this.send(chatId, text)
    const chat = this.get(chatId)
    const message = text.trim()
    if (!message) fail('INVALID_INPUT', 'Type a message first.')
    if ((chat.queued?.length ?? 0) >= MAX_QUEUED) fail('INVALID_INPUT', `At most ${MAX_QUEUED} messages can wait. Remove one first.`)
    chat.queued = [...(chat.queued ?? []), message]
    this.store.save(chat)
    this.broadcast('state.changed', { topic: 'chats' })
  }

  /** Takes a waiting message back out. */
  unqueue(chatId: string, index: number): void {
    const chat = this.get(chatId)
    if (!chat.queued?.[index]) return
    chat.queued = chat.queued.filter((_, i) => i !== index)
    if (!chat.queued.length) delete chat.queued
    this.store.save(chat)
    this.broadcast('state.changed', { topic: 'chats' })
  }

  stop(chatId: string): void {
    const run = this.runs.get(chatId)
    if (!run) return
    // Stop means stop: what was waiting is dropped too.
    const chat = this.store.get(chatId)
    if (chat?.queued) {
      delete chat.queued
      this.store.save(chat)
    }
    run.stopped = true
    killTree(run.child)
  }

  stopAll(): void {
    for (const id of [...this.runs.keys()]) this.stop(id)
  }

  isRunning(chatId: string): boolean {
    return this.runs.has(chatId)
  }

  /** Adds a message to a chat without starting a turn: a routine's dated result in its results thread (ADR 0028). */
  note(chatId: string, text: string): void {
    const chat = this.get(chatId)
    const message: ChatMessage = { id: randomUUID(), role: 'assistant', parts: [{ kind: 'text', text }], createdAt: nowIso() }
    chat.messages.push(message)
    chat.updatedAt = message.createdAt
    this.store.save(chat)
    this.broadcast('chat.event', { chatId, message: structuredClone(message), summary: this.summary(chat) })
  }

  /** The latest assistant message as text (tool calls as "[tool name]"), or '' when there is none. */
  lastReply(chatId: string): string {
    const last = [...this.get(chatId).messages].reverse().find((m) => m.role === 'assistant')
    return last ? last.parts.map((p) => (p.kind === 'tool' ? `[tool ${p.name}]` : p.text)).join('\n') + (last.error ? `\n(error: ${last.error})` : '') : ''
  }

  private finish(chat: ChatSession, reply: ChatMessage, acc: ChatAccumulator, error?: string): void {
    if (acc.sessionId && !chat.providerSessionId) chat.providerSessionId = acc.sessionId
    reply.streaming = false
    if (error) reply.error = error
    else if (reply.parts.length === 0) reply.error = 'No response.'
    chat.updatedAt = nowIso()
    this.store.save(chat)
    this.broadcast('chat.event', { chatId: chat.id, message: structuredClone(reply), summary: this.summary(chat) })
    this.broadcast('state.changed', { topic: 'chats' })
    this.emit('run', chat.id, false)
    this.sendQueued(chat.id, Boolean(error))
  }

  /** The next waiting message goes in once a turn ends well; after an error the queue waits for the user. */
  private sendQueued(chatId: string, failed: boolean): void {
    const chat = this.store.get(chatId)
    const next = chat?.queued?.[0]
    // A listener of 'run' may already have started a turn (a delegated result): the queue waits for that one.
    if (!chat || next === undefined || failed || this.runs.has(chatId)) return
    chat.queued = chat.queued!.slice(1)
    if (!chat.queued.length) delete chat.queued
    this.store.save(chat)
    try {
      this.send(chatId, next)
    } catch {
      chat.queued = [next, ...(chat.queued ?? [])]
      this.store.save(chat)
    }
  }

  private summary(chat: ChatSession): ChatSummary {
    return {
      id: chat.id,
      title: chat.title,
      cliId: chat.cliId,
      projectId: chat.projectId,
      updatedAt: chat.updatedAt,
      running: this.runs.has(chat.id),
      agentId: chat.agentId,
      ...(chat.botId ? { botId: chat.botId } : {}),
      ...(chat.queued?.length ? { queued: [...chat.queued] } : {})
    }
  }
}
