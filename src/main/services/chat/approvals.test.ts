import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CliInstance } from '@shared/domain'
import type { CliRegistry } from '../cli/registry'
import type { WorkspaceRepository } from '../workspaces/workspace-repository'
import { APPROVAL_TOOL, APPROVAL_TOOL_FULL, automaticDecision, decide, parsePromptRequest, toChatPrompt, withApprovalTool } from './approvals'
import { ChatService } from './chat-service'
import { ChatStore } from './chat-store'
import { CHAT_PROVIDERS } from './providers'

const log = { info: () => undefined, warn: () => undefined, error: () => undefined }
const bash = parsePromptRequest({ tool_name: 'Bash', input: { command: 'rm -rf build', description: 'Clean' }, tool_use_id: 't1' })
const questions = [{ question: 'Which store?', header: 'Store', multiSelect: false, options: [{ label: 'SQLite', description: 'One file' }, { label: 'Postgres' }] }]

describe('approval prompts (ADR 0073)', () => {
  it('turns Claude Code requests into cards', () => {
    expect(toChatPrompt('p1', bash)).toMatchObject({ kind: 'permission', tool: 'Bash', detail: 'rm -rf build' })
    // A single-choice question carries no multiSelect flag.
    expect(toChatPrompt('p2', parsePromptRequest({ tool_name: 'AskUserQuestion', input: { questions } }))).toEqual({ id: 'p2', kind: 'question', questions: [{ ...questions[0], multiSelect: undefined }] })
    expect(toChatPrompt('p3', parsePromptRequest({ tool_name: 'ExitPlanMode', input: { plan: '1. Do it' } }))).toEqual({ id: 'p3', kind: 'plan', plan: '1. Do it' })
    expect(parsePromptRequest({})).toEqual({ tool: 'a tool', input: {} })
  })

  it('read-only refuses tools, full access allows them, questions and plans always ask', () => {
    expect(automaticDecision(bash, 'read')).toMatchObject({ behavior: 'deny' })
    expect(automaticDecision(bash, 'full')).toEqual({ behavior: 'allow', updatedInput: bash.input })
    expect(automaticDecision(bash, 'ask')).toBeUndefined()
    expect(automaticDecision(parsePromptRequest({ tool_name: 'AskUserQuestion' }), 'full')).toBeUndefined()
    expect(automaticDecision(parsePromptRequest({ tool_name: 'ExitPlanMode' }), 'read')).toBeUndefined()
  })

  it('answers in Claude Code’s format', () => {
    expect(decide(bash, { kind: 'permission', allow: true }, 'ask')).toEqual({ behavior: 'allow', updatedInput: bash.input })
    expect(decide(bash, { kind: 'permission', allow: false }, 'ask')).toMatchObject({ behavior: 'deny' })
    const ask = parsePromptRequest({ tool_name: 'AskUserQuestion', input: { questions } })
    expect(decide(ask, { kind: 'question', answers: { 'Which store?': 'SQLite' } }, 'read')).toEqual({ behavior: 'allow', updatedInput: { questions, answers: { 'Which store?': 'SQLite' } } })
    const plan = parsePromptRequest({ tool_name: 'ExitPlanMode', input: { plan: 'x' } })
    expect(decide(plan, { kind: 'plan', approve: true }, 'full')).toMatchObject({ behavior: 'allow', updatedInput: { plan: 'x' }, updatedPermissions: [{ type: 'setMode', mode: 'bypassPermissions', destination: 'session' }] })
    expect(decide(plan, { kind: 'plan', approve: true }, 'ask')).toMatchObject({ updatedPermissions: [{ mode: 'default' }] })
    expect(decide(plan, { kind: 'plan', approve: false, feedback: 'smaller steps' }, 'ask')).toEqual({ behavior: 'deny', message: 'The user wants a different plan: smaller steps' })
  })

  it('offers the tool to chat agents and answers it with one text block', async () => {
    const host = withApprovalTool({ list: () => [], call: async () => ({ text: 'other' }) }, async () => ({ behavior: 'allow', updatedInput: {} }))
    expect(host.list().map((t) => t.name)).toEqual([APPROVAL_TOOL])
    expect(await host.call(APPROVAL_TOOL, {})).toEqual({ text: '{"behavior":"allow","updatedInput":{}}' })
    expect(await host.call('x', {})).toEqual({ text: 'other' })
  })

  it('Claude chats name the tool, and keep bypass available for an approved plan with full access', () => {
    const mcp = { endpoint: { url: 'http://127.0.0.1:1/mcp', token: 't' }, configPath: '/tmp/m.json', coordination: true }
    const run = CHAT_PROVIDERS.claude!.run({ prompt: 'x', autoApprove: true, plan: true, mcp })
    expect(run.args).toEqual(expect.arrayContaining(['--permission-prompt-tool', APPROVAL_TOOL_FULL, '--permission-mode', 'plan', '--allow-dangerously-skip-permissions']))
    expect(run.env?.MCP_TOOL_TIMEOUT).toBeTruthy()
    expect(CHAT_PROVIDERS.claude!.run({ prompt: 'x', autoApprove: false }).args).not.toContain('--permission-prompt-tool')
  })
})

describe('a chat waits on its cards (ADR 0073)', () => {
  const setup = (ask: boolean, plan = false) => {
    const dir = mkdtempSync(join(tmpdir(), 'hv-prompts-'))
    const store = new ChatStore(join(dir, 'chats'), log)
    store.load()
    const events: string[] = []
    const chats = new ChatService(store, {} as CliRegistry, {} as WorkspaceRepository, log, (event) => void events.push(event), join(dir, 'attachments'))
    chats.ensureAgentChat({ id: 'a1', petName: 'Ada', projectId: 'p1', cliId: 'claude', autoApprove: false } as CliInstance, '/home/me/app')
    chats.update('a1', { ask, plan })
    const internals = chats as unknown as { runs: Map<string, unknown> }
    internals.runs.set('a1', { proc: { kill: () => undefined }, stopped: false })
    return { chats, store, events }
  }

  it('holds an asked tool until the user answers, and tells every window', async () => {
    const { chats, events } = setup(true)
    const pending = chats.requestPrompt('a1', { tool_name: 'Bash', input: { command: 'ls' } })
    const [card] = chats.prompts('a1')
    expect(card).toMatchObject({ kind: 'permission', detail: 'ls' })
    expect(events).toContain('state.changed')
    expect(() => chats.answer('a1', card!.id, { kind: 'plan', approve: true })).toThrow(/does not fit/)
    chats.answer('a1', card!.id, { kind: 'permission', allow: true })
    expect(await pending).toEqual({ behavior: 'allow', updatedInput: { command: 'ls' } })
    expect(chats.prompts('a1')).toEqual([])
    expect(() => chats.answer('a1', card!.id, { kind: 'permission', allow: true })).toThrow(/already answered/)
  })

  it('refuses tools at once in read-only, and drops open cards when stopped', async () => {
    const { chats } = setup(false)
    expect(await chats.requestPrompt('a1', { tool_name: 'Edit', input: {} })).toMatchObject({ behavior: 'deny' })
    const question = chats.requestPrompt('a1', { tool_name: 'AskUserQuestion', input: { questions } })
    expect(chats.prompts('a1')).toHaveLength(1)
    chats.stop('a1')
    expect(await question).toMatchObject({ behavior: 'deny' })
    expect(chats.prompts('a1')).toEqual([])
  })

  it('an approved plan leaves plan mode for the next message too', async () => {
    const { chats, store } = setup(true, true)
    const pending = chats.requestPrompt('a1', { tool_name: 'ExitPlanMode', input: { plan: 'Steps' } })
    chats.answer('a1', chats.prompts('a1')[0]!.id, { kind: 'plan', approve: true })
    expect(await pending).toMatchObject({ behavior: 'allow' })
    expect(store.get('a1')?.plan).toBeUndefined()
  })

  it('a chat that is not answering refuses', async () => {
    const { chats } = setup(true)
    ;(chats as unknown as { runs: Map<string, unknown> }).runs.clear()
    expect(await chats.requestPrompt('a1', { tool_name: 'Bash', input: {} })).toMatchObject({ behavior: 'deny' })
  })
})
