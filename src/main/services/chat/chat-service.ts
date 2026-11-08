import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { MAX_QUEUED } from '@shared/domain/prompt'
import { EventEmitter } from 'node:events'
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import type { ChatChoice, CliInstance } from '@shared/domain'
import { CHAT_CLI_IDS, type ChatAttachment, type ChatCatalog, type ChatMessage, type ChatSession, type ChatSummary, type UsageLimits } from '@shared/domain/chat'
import { fail } from '@shared/errors'
import type { Logger } from '../../app/logger'
import type { McpEndpoint } from '../cli/adapters/types'
import type { CliRegistry } from '../cli/registry'
import type { Emit } from '../events'
import { nowIso } from '../events'
import { sanitizeEnv } from '../pty/env'
import { resolveSpawnTarget } from '../pty/spawn-target'
import { localChatProcesses, type ChatProcess, type ChatProcessBackend } from './chat-process'
import type { WorkspaceRepository } from '../workspaces/workspace-repository'
import { ChatAccumulator } from './accumulator'
import type { ChatStore } from './chat-store'
import { probeCli } from './cli-probe'
import { CHAT_PROVIDERS, transcriptPrompt, type CatalogRunner, type ChatMcp } from './providers'
import type { Checkpoints } from './checkpoints'
import type { LineParser } from './parsers'

const CATALOG_TTL_MS = 10 * 60 * 1000
/** Limits move with every turn: a fresh reading at most this often unless the user refreshes. */
const LIMITS_TTL_MS = 60 * 1000
const EMIT_EVERY_MS = 50
const MAX_STDERR = 4000
/** Files dropped from disk are sent by path; anything bigger than this is refused. */
const MAX_ATTACHMENT_BYTES = 200 * 1024 * 1024
/** A checkpoint that takes longer than this is skipped: the turn never waits long for it (ADR 0058). */
const CHECKPOINT_TIMEOUT_MS = 5000

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
export const safeName = (name: string): string => basename(name).replace(/[^\w.() -]+/g, '_').slice(0, 120) || 'file'

interface Run {
  /** Absent while the turn's checkpoint is being written, before the CLI starts. */
  proc?: ChatProcess
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
  private readonly limitReadings = new Map<string, { at: number; limits: Promise<UsageLimits> }>()

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
    /** Where each turn's CLI runs: the terminal host, so a reply outlives Hiveory (ADR 0051). */
    private readonly processes: ChatProcessBackend = localChatProcesses,
    /** Each turn's before/after trees (ADR 0058); absent: turns keep no checkpoints. */
    private readonly checkpoints?: Checkpoints
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

  /**
   * The chat behind a Work agent in chat view. Its CLI and folder follow the agent and never change;
   * a new one starts on `defaults` (its Workspace's model and effort for that CLI).
   */
  ensureAgentChat(instance: CliInstance, cwd: string, defaults?: ChatChoice): void {
    const existing = this.store.get(instance.id)
    if (existing) {
      // Auto-approve turned on (the agent's or Settings', ADR 0049) gives an existing chat full access too.
      const autoApprove = existing.autoApprove || instance.autoApprove
      if (existing.cwd !== cwd || autoApprove !== existing.autoApprove) this.store.save({ ...existing, cwd, autoApprove })
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
      ...(defaults?.model ? { model: defaults.model } : {}),
      ...(defaults?.effort ? { effort: defaults.effort } : {}),
      autoApprove: instance.autoApprove,
      messages: [],
      createdAt: now,
      updatedAt: now
    })
  }

  update(chatId: string, patch: Partial<Pick<ChatSession, 'cliId' | 'model' | 'effort' | 'autoApprove' | 'title' | 'plan' | 'fast'>>): ChatSession {
    const chat = this.get(chatId)
    const started = chat.messages.length > 0
    if (patch.cliId !== undefined && patch.cliId !== chat.cliId) {
      if (!this.clis().includes(patch.cliId)) fail('CLI_UNAVAILABLE', 'That CLI is not available for chat.')
      if (this.runs.has(chatId)) fail('INVALID_INPUT', 'Wait for the reply to finish before switching CLI.')
      // A different CLI means different models; reset the model-specific choices. A started
      // conversation hands off: the new CLI's first turn gets it as context (ADR 0058, replaces ADR 0012's lock).
      chat.cliId = patch.cliId
      chat.model = undefined
      chat.effort = undefined
      chat.fast = undefined
      chat.providerSessionId = undefined
      if (!CHAT_PROVIDERS[patch.cliId]?.plan) chat.plan = undefined
      if (started) chat.handoff = true
    }
    if ('model' in patch) chat.model = patch.model || undefined
    if ('effort' in patch) chat.effort = patch.effort || undefined
    if (patch.autoApprove !== undefined) chat.autoApprove = patch.autoApprove
    if (patch.plan !== undefined) chat.plan = patch.plan || undefined
    if (patch.fast !== undefined) chat.fast = patch.fast || undefined
    if (patch.title !== undefined) chat.title = patch.title.trim().slice(0, 80) || chat.title
    chat.updatedAt = nowIso()
    this.store.save(chat)
    // Every window and phone showing this chat picks up the change (it may come from the phone).
    this.broadcast('state.changed', { topic: 'chats', chatId })
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
    const catalog = provider
      .models(this.cliRunner(executable))
      .then((found): ChatCatalog => {
        const { models, commands } = Array.isArray(found) ? { models: found, commands: [] } : found
        return { cliId, models, ...(commands.length ? { commands } : {}), ...(provider.plan ? { plan: true } : {}), ...(provider.limits ? { limits: true } : {}) }
      })
      .catch((error: Error) => {
        this.log.warn(`Model discovery failed for ${cliId}`, error)
        // Default model always works; discovery errors never block chatting.
        return { cliId, models: [{ id: '', label: 'Default', description: "Uses the CLI's configured model" }], error: 'Could not list models.' }
      })
    this.catalogs.set(cliId, { at: Date.now(), catalog })
    return catalog
  }

  /** The CLI's plan limits (5-hour, weekly…), as the CLI itself reports them (ADR 0055). */
  limits(cliId: string, refresh = false): Promise<UsageLimits> {
    const cached = this.limitReadings.get(cliId)
    if (cached && !refresh && Date.now() - cached.at < LIMITS_TTL_MS) return cached.limits
    const provider = CHAT_PROVIDERS[cliId]
    const executable = this.registry.executable(cliId)
    const name = this.registry.displayName(cliId)
    if (!provider?.limits || !executable) return Promise.resolve({ cliId, windows: [], note: `${name} does not report usage limits.`, checkedAt: nowIso() })
    const limits = provider
      .limits(this.cliRunner(executable))
      .then((reading) => ({ cliId, ...reading, checkedAt: nowIso() }))
      .catch((error: Error) => {
        this.log.warn(`Usage limits failed for ${cliId}`, error)
        this.limitReadings.delete(cliId)
        return { cliId, windows: [], note: `${name} could not report its limits: ${error.message}`, checkedAt: nowIso() }
      })
    this.limitReadings.set(cliId, { at: Date.now(), limits })
    return limits
  }

  /** Reaches an installed CLI for discovery: its stdout, or an answer over its JSON-lines protocol. */
  private cliRunner(executable: string): CatalogRunner {
    return {
      run: (args) =>
        new Promise((resolve, reject) => {
          const target = resolveSpawnTarget(executable, args)
          execFile(target.file, target.args, { timeout: 30_000, windowsHide: true, maxBuffer: 32 * 1024 * 1024, env: sanitizeEnv(process.env) }, (error, stdout) =>
            error ? reject(error) : resolve(stdout.toString())
          )
        }),
      ask: (args, messages, answer) => probeCli(resolveSpawnTarget(executable, args), messages, answer, { env: sanitizeEnv(process.env), cwd: homedir() })
    }
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
    const asked: ChatMessage = {
      id: randomUUID(),
      role: 'user',
      parts: prompt ? [{ kind: 'text', text: prompt }] : [],
      ...(attachments.length ? { attachments } : {}),
      createdAt: now
    }
    chat.messages.push(asked)
    const reply: ChatMessage = { id: randomUUID(), role: 'assistant', parts: [], createdAt: now, streaming: true }
    chat.messages.push(reply)
    if (chat.title === 'New chat') chat.title = (prompt || attachments[0]!.name).replace(/\s+/g, ' ').slice(0, 60)
    chat.updatedAt = now
    this.store.save(chat)
    // Every window and phone shows the question at once, whoever sent it (the phone, another agent).
    this.broadcast('chat.event', { chatId, message: structuredClone(asked), summary: this.summary(chat) })

    // Providers without resume get the transcript every turn; so does the first turn after a CLI switch.
    const fresh = !provider!.resumable || chat.handoff === true
    const body = fresh ? transcriptPrompt(history, prompt) : prompt
    const spec = provider!.run({
      prompt: body,
      model: chat.model,
      effort: chat.effort,
      sessionId: fresh ? undefined : chat.providerSessionId,
      autoApprove: chat.autoApprove,
      attachments,
      mcp: this.mcpConfig(chat),
      plan: Boolean(chat.plan && provider!.plan),
      fast: chat.fast === true
    })
    if (spec.assignedSessionId) chat.providerSessionId = spec.assignedSessionId

    // The turn is running from here (a second send is refused), first writing its checkpoint.
    const run: Run = { stopped: false }
    this.runs.set(chatId, run)
    this.broadcast('state.changed', { topic: 'chats' })
    // The reply shows as working at once, while the checkpoint is written.
    this.broadcast('chat.event', { chatId, message: structuredClone(reply), summary: this.summary(chat) })
    this.emit('run', chatId, true)
    void this.checkpoint(chat.cwd).then((before) => {
      if (before) reply.checkpoint = { before }
      if (run.stopped) {
        this.runs.delete(chatId)
        this.finish(chat, reply, new ChatAccumulator(reply), 'Stopped')
        return
      }
      let proc: ChatProcess
      try {
        const target = resolveSpawnTarget(executable!, spec.args)
        for (const file of spec.files ?? []) {
          mkdirSync(dirname(file.path), { recursive: true })
          writeFileSync(file.path, file.content)
        }
        proc = this.processes.spawn({ key: chatId, file: target.file, args: target.args, cwd: chat.cwd, env: { ...sanitizeEnv(process.env), ...spec.env }, stdin: spec.stdin })
      } catch (error) {
        this.runs.delete(chatId)
        this.finish(chat, reply, new ChatAccumulator(reply), error instanceof Error ? error.message : String(error))
        return
      }
      this.follow(chat, reply, proc, provider!.parser(), run)
    })
  }

  /** The folder as a Git tree before a turn, or undefined (not a repository, too slow, failed). */
  private checkpoint(cwd: string): Promise<string | undefined> {
    if (!this.checkpoints) return Promise.resolve(undefined)
    return Promise.race([
      this.checkpoints.snapshot(cwd).catch(() => undefined),
      new Promise<undefined>((done) => setTimeout(() => done(undefined), CHECKPOINT_TIMEOUT_MS))
    ])
  }

  /** The trees a turn's changes are listed from (Changes tab, ADR 0058). */
  turnCheckpoint(chatId: string, messageId: string): ChatMessage['checkpoint'] {
    return this.store.get(chatId)?.messages.find((m) => m.id === messageId)?.checkpoint
  }

  /** Puts back every file one turn changed, as it was before the turn (ADR 0058). */
  async revertTurn(chatId: string, messageId: string): Promise<ChatMessage> {
    const chat = this.get(chatId)
    const message = chat.messages.find((m) => m.id === messageId)
    const checkpoint = message?.checkpoint
    if (!message || !checkpoint?.after || !this.checkpoints) return fail('NOT_FOUND', 'That turn has no saved checkpoint.')
    if (this.runs.has(chatId)) fail('INVALID_INPUT', 'Wait for the reply to finish first.')
    try {
      await this.checkpoints.revert(chat.cwd, checkpoint.before, checkpoint.after)
    } catch (error) {
      fail('GIT_FAILED', 'Could not undo that turn.', { hint: error instanceof Error ? error.message.slice(0, 300) : undefined })
    }
    message.checkpoint = { ...checkpoint, reverted: true }
    this.store.save(chat)
    this.broadcast('chat.event', { chatId, message: structuredClone(message), summary: this.summary(chat) })
    return message
  }

  /**
   * Streams a turn's output into its reply until it ends. A run taken back after a restart (ADR 0051)
   * comes here too, with its whole output from the first byte, so the reply is rebuilt as it was.
   */
  private follow(chat: ChatSession, reply: ChatMessage, proc: ChatProcess, parse: LineParser, existing?: Run): void {
    const chatId = chat.id
    const acc = new ChatAccumulator(reply)
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

    const run: Run = existing ?? { stopped: false }
    run.proc = proc
    this.runs.set(chatId, run)
    this.broadcast('state.changed', { topic: 'chats' })
    this.emit('run', chatId, true)
    push(true)

    let buffer = ''
    proc.onStdout((chunk) => {
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
    proc.onStderr((chunk) => {
      stderr = (stderr + chunk).slice(-MAX_STDERR)
    })
    proc.onClose((code, failure) => {
      if (buffer.trim()) for (const event of parse(buffer)) acc.apply(event)
      if (pending) clearTimeout(pending)
      this.runs.delete(chatId)
      let error: string | undefined
      if (run.stopped) error = 'Stopped'
      else if (failure && !acc.text()) error = failure
      else if (acc.errors.length) error = acc.errors.join('\n')
      else if (code !== 0 && !acc.text()) error = stderr.trim().split(/\r?\n/).slice(-6).join('\n') || `Exited with code ${code}`
      this.finish(chat, reply, acc, error)
    })
  }

  /**
   * At start-up (ADR 0051): every reply that was still streaming when Hiveory last ran is taken back
   * from the terminal host, rebuilt from its run's whole output, and streams on, or is finished if
   * the run ended meanwhile. One whose run is gone (after a reboot) is marked interrupted.
   */
  recover(): void {
    for (const chat of this.store.all()) {
      const reply = chat.messages.at(-1)
      const stale = chat.messages.filter((m) => m.streaming && m !== reply)
      for (const m of stale) Object.assign(m, { streaming: false, error: m.error ?? 'Interrupted' })
      const provider = chat.cliId ? CHAT_PROVIDERS[chat.cliId] : undefined
      const proc = reply?.streaming && provider ? this.processes.adopt(chat.id) : undefined
      if (reply?.streaming && proc && provider) {
        reply.parts = []
        delete reply.error
        this.follow(chat, reply, proc, provider.parser())
        continue
      }
      if (reply?.streaming) Object.assign(reply, { streaming: false, error: reply.error ?? 'Interrupted' })
      if (stale.length || reply?.error === 'Interrupted') this.store.save(chat)
    }
  }

  /** Quitting with agents kept: every running turn carries on in the terminal host for the next start. */
  detachAll(): void {
    for (const [chatId, run] of this.runs) {
      run.proc?.detach()
      const chat = this.store.get(chatId)
      if (chat) this.store.save(chat)
    }
    this.runs.clear()
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
    run.proc?.kill()
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
    // The new CLI has the conversation now; later turns resume its session.
    if (!error) delete chat.handoff
    reply.streaming = false
    if (error) reply.error = error
    else if (reply.parts.length === 0) reply.error = 'No response.'
    chat.updatedAt = nowIso()
    this.store.save(chat)
    this.broadcast('chat.event', { chatId: chat.id, message: structuredClone(reply), summary: this.summary(chat) })
    this.broadcast('state.changed', { topic: 'chats' })
    this.emit('run', chat.id, false)
    // The turn's "after" is written before the next waiting message starts changing files.
    void this.closeCheckpoint(chat, reply).finally(() => this.sendQueued(chat.id, Boolean(error)))
  }

  private async closeCheckpoint(chat: ChatSession, reply: ChatMessage): Promise<void> {
    const before = reply.checkpoint?.before
    if (!before || !this.checkpoints) return
    try {
      const after = await this.checkpoint(chat.cwd)
      if (!after) return
      reply.checkpoint = await this.checkpoints.measure(chat.cwd, before, after)
    } catch (error) {
      this.log.warn('Turn checkpoint failed', error)
      return
    }
    const current = this.store.get(chat.id)
    const stored = current?.messages.find((m) => m.id === reply.id)
    if (!current || !stored) return
    stored.checkpoint = reply.checkpoint
    this.store.save(current)
    this.broadcast('chat.event', { chatId: chat.id, message: structuredClone(stored), summary: this.summary(current) })
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
      ...(chat.workspaceId ? { workspaceId: chat.workspaceId } : {}),
      updatedAt: chat.updatedAt,
      running: this.runs.has(chat.id),
      agentId: chat.agentId,
      ...(chat.queued?.length ? { queued: [...chat.queued] } : {})
    }
  }
}
