import { randomUUID } from 'node:crypto'
import { APPROVAL_TIMEOUT_MS, approvalDetail, approvalGate, approvalTool, toolRisk, type ApprovalLevel, type ApprovalRequest } from '@shared/domain/approval'
import { fail } from '@shared/errors'
import type { ToolFamily } from '../agent-tools/agent-tools'

interface Deps {
  /** The list changed: the renderer re-reads it. */
  changed(): void
  /** A new request: tell the user (a desktop notification while Hiveory is in the background). */
  notify(request: ApprovalRequest): void
  timeoutMs?: number
}

interface Pending {
  request: ApprovalRequest
  resolve(allowed: boolean): void
  timer: NodeJS.Timeout
}

/**
 * Bot approvals (ADR 0029): a bot's app and MCP calls wait here for the user's yes when its approval
 * level says so, and read-only runs (triggers) never change anything. Requests live in memory: a
 * restart ends the run anyway, and an unanswered one is declined after 15 minutes.
 */
export class ApprovalService {
  private readonly pending = new Map<string, Pending>()

  constructor(private readonly d: Deps) {}

  list(): ApprovalRequest[] {
    return [...this.pending.values()].map((p) => p.request).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  /** Resolves true when the user allows it; false when they decline, it times out or its thread goes away. */
  ask(input: Omit<ApprovalRequest, 'id' | 'createdAt'>): Promise<boolean> {
    const request: ApprovalRequest = { ...input, id: randomUUID(), createdAt: new Date().toISOString() }
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => this.settle(request.id, false), this.d.timeoutMs ?? APPROVAL_TIMEOUT_MS)
      timer.unref?.()
      this.pending.set(request.id, { request, resolve, timer })
      this.d.changed()
      this.d.notify(request)
    })
  }

  answer(approvalId: string, allow: boolean): void {
    if (!this.pending.has(approvalId)) fail('NOT_FOUND', 'That request was already answered or has expired.')
    this.settle(approvalId, allow)
  }

  /** Declines what a thread (or every thread of a bot) is waiting on: it was deleted or stopped. */
  drop(filter: { threadId?: string; botId?: string }): void {
    for (const { request } of [...this.pending.values()]) {
      if ((filter.threadId && request.threadId === filter.threadId) || (filter.botId && request.botId === filter.botId)) this.settle(request.id, false)
    }
  }

  /**
   * A bot thread's view of a tool family: reads go straight through; changes and sends are refused in
   * read-only runs, or wait for the user when the bot's level asks for it.
   */
  guard(family: ToolFamily, thread: { botId: string; threadId: string; level: ApprovalLevel; readOnly: boolean }): ToolFamily {
    return {
      handles: (name) => family.handles(name),
      definitions: () => family.definitions(),
      call: async (caller, name, args) => {
        const risk = toolRisk(name, args)
        const verdict = approvalGate(thread.level, risk, thread.readOnly)
        if (verdict === 'refuse') {
          return { text: 'This run is read-only: you may look things up in apps, but not change or send anything. Say what you would do instead.', isError: true }
        }
        if (verdict === 'ask' && risk !== 'read') {
          const allowed = await this.ask({ botId: thread.botId, threadId: thread.threadId, tool: approvalTool(name, args), risk, detail: approvalDetail(args) })
          if (!allowed) return { text: "The user declined this, or didn't answer in time. Don't try it again; say what you would have done.", isError: true }
        }
        return family.call(caller, name, args)
      }
    }
  }

  dispose(): void {
    for (const id of [...this.pending.keys()]) this.settle(id, false)
  }

  private settle(approvalId: string, allow: boolean): void {
    const entry = this.pending.get(approvalId)
    if (!entry) return
    clearTimeout(entry.timer)
    this.pending.delete(approvalId)
    entry.resolve(allow)
    this.d.changed()
  }
}
