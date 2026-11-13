import type { ChatAccess, ChatPrompt, ChatPromptAnswer, ChatQuestion } from '@shared/domain/chat'
import type { ToolDefinition, ToolHost } from '../agent-tools/mcp-protocol'
import { MCP_SERVER_NAME } from '../cli/adapters/mcp-injection'

/**
 * A chat's approvals, questions and plan approval (ADR 0073). Claude Code in print mode hands every
 * permission request, `AskUserQuestion` and `ExitPlanMode` to the MCP tool named by
 * `--permission-prompt-tool`; Hiveory's own MCP server offers that tool to chat agents and holds the
 * call open until the user answers on a card.
 */

export const APPROVAL_TOOL = 'approval_prompt'
/** The name `--permission-prompt-tool` takes. */
export const APPROVAL_TOOL_FULL = `mcp__${MCP_SERVER_NAME}__${APPROVAL_TOOL}`
/** How long the CLI waits on a card before giving up (its MCP tool timeout): a working day. */
export const APPROVAL_WAIT_MS = 12 * 60 * 60 * 1000

const DEFINITION: ToolDefinition = {
  name: APPROVAL_TOOL,
  description: 'Hiveory uses this tool to ask the user for permission and to show your questions and plans. Never call it yourself.',
  inputSchema: { type: 'object', properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } }, required: ['tool_name'] }
}

/** What Claude Code asks about: the tool it wants to use and its input. */
export interface PromptRequest {
  tool: string
  input: Record<string, unknown>
}

/** Claude Code's answer format: allow (with the input, possibly changed) or deny with a reason. */
export type Decision =
  | { behavior: 'allow'; updatedInput: Record<string, unknown>; updatedPermissions?: Array<Record<string, unknown>> }
  | { behavior: 'deny'; message: string }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

export const parsePromptRequest = (args: Record<string, unknown>): PromptRequest => ({
  tool: typeof args.tool_name === 'string' ? args.tool_name : typeof args.toolName === 'string' ? args.toolName : 'a tool',
  input: isRecord(args.input) ? args.input : {}
})

/** What a tool call would do, in one line: its command, file, address or pattern. */
export const toolDetail = (input: Record<string, unknown>): string => {
  for (const key of ['command', 'file_path', 'notebook_path', 'path', 'url', 'pattern', 'query', 'description']) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 500)
  }
  return ''
}

const parseQuestions = (raw: unknown): ChatQuestion[] =>
  (Array.isArray(raw) ? raw : []).filter(isRecord).flatMap((q) =>
    typeof q.question === 'string'
      ? [
          {
            question: q.question,
            ...(typeof q.header === 'string' ? { header: q.header } : {}),
            ...(q.multiSelect === true ? { multiSelect: true } : {}),
            options: (Array.isArray(q.options) ? q.options : [])
              .filter(isRecord)
              .flatMap((o) => (typeof o.label === 'string' ? [{ label: o.label, ...(typeof o.description === 'string' ? { description: o.description } : {}) }] : []))
          }
        ]
      : []
  )

/** The card a request becomes. */
export function toChatPrompt(id: string, request: PromptRequest): ChatPrompt {
  if (request.tool === 'AskUserQuestion') return { id, kind: 'question', questions: parseQuestions(request.input.questions) }
  if (request.tool === 'ExitPlanMode') return { id, kind: 'plan', plan: typeof request.input.plan === 'string' ? request.input.plan : '' }
  return { id, kind: 'permission', tool: request.tool, detail: toolDetail(request.input), input: JSON.stringify(request.input, null, 2).slice(0, 4000) }
}

/**
 * Requests Hiveory answers itself: a read-only chat refuses every tool that needs permission, a full-access
 * one allows it. Questions and plans always go to the user.
 */
export function automaticDecision(request: PromptRequest, access: ChatAccess): Decision | undefined {
  if (request.tool === 'AskUserQuestion' || request.tool === 'ExitPlanMode') return undefined
  if (access === 'read') {
    return { behavior: 'deny', message: 'This chat has read-only access, so the user did not allow that. Say what you would change and let them switch to Ask or Full access.' }
  }
  if (access === 'full') return { behavior: 'allow', updatedInput: request.input }
  return undefined
}

/** The user's answer, in Claude Code's format. An approved plan leaves plan mode for the chat's own access. */
export function decide(request: PromptRequest, answer: ChatPromptAnswer, access: ChatAccess): Decision {
  switch (answer.kind) {
    case 'permission':
      return answer.allow ? { behavior: 'allow', updatedInput: request.input } : { behavior: 'deny', message: 'The user denied this. Do not try it another way; ask them what to do instead.' }
    case 'question':
      return { behavior: 'allow', updatedInput: { ...request.input, answers: answer.answers } }
    case 'plan':
      if (!answer.approve) {
        const feedback = answer.feedback?.trim()
        return { behavior: 'deny', message: feedback ? `The user wants a different plan: ${feedback}` : 'The user wants to keep planning. Ask them what to change.' }
      }
      return { behavior: 'allow', updatedInput: request.input, updatedPermissions: [{ type: 'setMode', mode: access === 'full' ? 'bypassPermissions' : 'default', destination: 'session' }] }
  }
}

/** The answer kind a prompt takes. */
export const answers = (prompt: ChatPrompt, answer: ChatPromptAnswer): boolean => prompt.kind === answer.kind

/** Adds the approval tool to a chat agent's MCP tools; `ask` resolves when the user answers. */
export const withApprovalTool = (host: ToolHost, ask: (args: Record<string, unknown>) => Promise<Decision>): ToolHost => ({
  list: () => [...host.list(), DEFINITION],
  call: async (name, args) => (name === APPROVAL_TOOL ? { text: JSON.stringify(await ask(args)) } : host.call(name, args))
})
