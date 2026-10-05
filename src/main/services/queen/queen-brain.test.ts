import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { QueenContext } from '@shared/queen/actions'
import { isAllowedBrainUrl, planFromToolArgs, stateMessage, systemPrompt } from '@shared/queen/brain'
import { parseCommand } from '@shared/queen/parse'
import { SecretBox, type Sealer } from '../connections/secret-box'
import { StateStore } from '../persistence/state-store'
import { QueenBrain } from './queen-brain'

const log = { info: () => undefined, warn: () => undefined, error: () => undefined }
const sealer: Sealer = {
  isEncryptionAvailable: () => true,
  encryptString: (v) => Buffer.from([...Buffer.from(v)].map((b) => b ^ 0x5a)),
  decryptString: (b) => Buffer.from([...b].map((x) => x ^ 0x5a)).toString()
}

const ctx: QueenContext = {
  mode: 'workspace',
  projectId: 'p1',
  workspaceId: 'w1',
  projects: [{ id: 'p1', name: 'demo-app' }],
  workspaces: [{ id: 'w1', name: 'Main', kind: 'main' }],
  agents: [
    { id: 'a1', petName: 'Bruno', cliId: 'claude', workspaceId: 'w1', status: 'waiting-for-you' },
    { id: 'a2', petName: 'Luna', cliId: 'codex', workspaceId: 'w1', status: 'idle' }
  ],
  clis: [{ id: 'claude', displayName: 'Claude Code' }],
  presets: []
}

describe('Queen Bee model plans', () => {
  it('accepts valid plans and drops the empty fields providers send', () => {
    expect(planFromToolArgs({ actions: [{ type: 'open-agents', cliId: 'claude', count: 2, workspaceId: 'w1', projectId: 'p1', agentId: '', text: null }] }, ctx)).toEqual({
      kind: 'actions',
      actions: [{ type: 'open-agents', cliId: 'claude', count: 2, workspaceId: 'w1', projectId: 'p1' }]
    })
  })

  it('runs nothing when any action is invalid or uses an id it was not shown', () => {
    expect(planFromToolArgs({ actions: [{ type: 'restart-agent', agentId: 'a9' }] }, ctx)).toEqual({ kind: 'unknown' })
    expect(planFromToolArgs({ actions: [{ type: 'report', focus: 'all' }, { type: 'delete-everything' }] }, ctx)).toEqual({ kind: 'unknown' })
    expect(planFromToolArgs({ actions: [{ type: 'open-agents', cliId: 'claude', count: 20, workspaceId: 'w1', projectId: 'p1' }] }, ctx)).toEqual({ kind: 'unknown' })
    expect(planFromToolArgs('nonsense', ctx)).toEqual({ kind: 'unknown' })
  })

  it('needs a yes before a model closes or messages an agent', () => {
    expect(planFromToolArgs({ actions: [{ type: 'message-agent', agentId: 'a1', text: 'run the tests' }] }, ctx)).toMatchObject({ confirm: 'Send to Bruno: “run the tests”?' })
    expect(planFromToolArgs({ actions: [{ type: 'close-agents', agentIds: ['a1', 'a2'] }] }, ctx)).toMatchObject({ confirm: 'Close Bruno, Luna?' })
  })

  it('passes questions and replies through', () => {
    expect(planFromToolArgs({ actions: [], question: 'Which Bruno?' }, ctx)).toEqual({ kind: 'ask', question: { text: 'Which Bruno?' } })
    expect(planFromToolArgs({ actions: [], reply: 'I only run Hiveory.' }, ctx)).toEqual({ kind: 'reply', text: 'I only run Hiveory.' })
  })

  it('shows the model ids and statuses, with a fixed system prompt', () => {
    const state = stateMessage(ctx, 'who needs me?')
    expect(state).toContain('a1 Bruno (cli claude, workspace w1, waiting for you)')
    expect(state).toContain('page: workspace Main (w1) in project demo-app (p1)')
    expect(state.endsWith('REQUEST\nwho needs me?')).toBe(true)
    expect(systemPrompt({ name: 'Ada', tagline: 'Strict' })).toBe(systemPrompt({ name: 'Ada', tagline: 'Strict' }))
  })

  it('allows https anywhere and http only on this computer', () => {
    expect(isAllowedBrainUrl('https://api.openai.com/v1')).toBe(true)
    expect(isAllowedBrainUrl('http://localhost:11434/v1')).toBe(true)
    expect(isAllowedBrainUrl('http://192.168.1.5/v1')).toBe(false)
    expect(isAllowedBrainUrl('https://user:pass@example.com')).toBe(false)
    expect(isAllowedBrainUrl('file:///etc/passwd')).toBe(false)
  })
})

describe('Queen Bee message commands (rules)', () => {
  it('keeps the exact words for "tell <agent> to …"', () => {
    expect(parseCommand('Tell Bruno to run `pnpm test` and fix what fails', ctx)).toEqual({
      kind: 'actions',
      actions: [{ type: 'message-agent', agentId: 'a1', text: 'run `pnpm test` and fix what fails' }]
    })
    expect(parseCommand('hey queen, ask luna: what changed?', ctx)).toMatchObject({ actions: [{ agentId: 'a2', text: 'what changed?' }] })
    // Not an agent name: falls through to the other rules.
    expect(parseCommand('tell me the status', ctx)).toMatchObject({ actions: [{ type: 'report' }] })
  })
})

describe('Queen Bee brain service', () => {
  const setup = (respond: (url: string, init: RequestInit) => Response | Promise<Response>) => {
    const dir = mkdtempSync(join(tmpdir(), 'hv-brain-'))
    const store = new StateStore(join(dir, 'state.json'), log)
    const calls: Array<{ url: string; init: RequestInit; body: Record<string, unknown> }> = []
    const http = (async (url: string, init: RequestInit) => {
      calls.push({ url, init, body: init.body ? JSON.parse(String(init.body)) : {} })
      return respond(url, init)
    }) as unknown as typeof fetch
    return { brain: new QueenBrain(store, new SecretBox(sealer), http), calls, store }
  }
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

  it('forces one plan call over the OpenAI format, key sealed and never shown', async () => {
    const { brain, calls, store } = setup(() =>
      json(200, { choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify({ actions: [{ type: 'report', focus: 'waiting-for-you' }] }) } }] } }] })
    )
    const [view] = brain.save({ provider: 'openai', label: '', baseUrl: '', model: 'gpt-5-mini', apiKey: 'sk-secret-123' })
    expect(view).toMatchObject({ provider: 'openai', kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5-mini', hasKey: true, encrypted: true })
    expect(JSON.stringify(view)).not.toContain('sk-secret-123')
    expect(JSON.stringify(store.state.queenBrains)).not.toContain('sk-secret-123')
    expect(await brain.plan('who needs me', ctx, 'ada')).toEqual({ kind: 'actions', actions: [{ type: 'report', focus: 'waiting-for-you' }] })
    const [call] = calls
    expect(call!.url).toBe('https://api.openai.com/v1/chat/completions')
    expect((call!.init.headers as Record<string, string>).Authorization).toBe('Bearer sk-secret-123')
    expect(call!.body.tool_choice).toEqual({ type: 'function', function: { name: 'plan' } })
    expect(call!.body.reasoning_effort).toBe('minimal')
  })

  it('keeps several accounts per provider and falls back down the list', async () => {
    const { brain, calls } = setup((url) =>
      url.includes('primary.example')
        ? json(429, { error: 'slow down' })
        : json(200, { choices: [{ message: { tool_calls: [{ function: { arguments: '{"actions":[{"type":"navigate","to":"home"}]}' } }] } }] })
    )
    brain.save({ provider: 'custom', label: 'Primary', kind: 'openai', baseUrl: 'https://primary.example/v1', model: 'a', apiKey: 'k1' })
    const accounts = brain.save({ provider: 'custom', label: 'Backup', kind: 'openai', baseUrl: 'https://backup.example/v1', model: 'b', apiKey: 'k2' })
    expect(accounts.map((a) => a.label)).toEqual(['Primary', 'Backup'])
    expect(() => brain.save({ provider: 'custom', label: 'backup', baseUrl: 'https://x.example/v1', model: 'c' })).toThrow(/already exists/)
    expect(await brain.plan('home', ctx, 'ada')).toMatchObject({ actions: [{ type: 'navigate', to: 'home' }] })
    expect(calls.map((c) => new URL(c.url).host)).toEqual(['primary.example', 'backup.example'])
    // Reordering makes the backup primary.
    expect(brain.move(accounts[1]!.id, 0).map((a) => a.label)).toEqual(['Backup', 'Primary'])
  })

  it('lists models in each provider format, with the typed key', async () => {
    const o = setup(() => json(200, { data: [{ id: 'gpt-b' }, { id: 'gpt-a' }, { id: 'gpt-a' }] }))
    expect(await o.brain.listModels({ provider: 'openrouter', baseUrl: '', apiKey: 'or-key' })).toEqual(['gpt-a', 'gpt-b'])
    expect(o.calls[0]!.url).toBe('https://openrouter.ai/api/v1/models')
    const g = setup(() => json(200, { models: [{ name: 'models/gemini-x', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embed', supportedGenerationMethods: ['embedContent'] }] }))
    expect(await g.brain.listModels({ provider: 'gemini', baseUrl: '', apiKey: 'g' })).toEqual(['gemini-x'])
    expect(g.calls[0]!.url).not.toContain('key=')
  })

  it('retries once without the reasoning hint when a model refuses it', async () => {
    let n = 0
    const { brain, calls } = setup(() =>
      n++ === 0
        ? json(400, { error: { message: "Unsupported parameter: 'reasoning_effort'" } })
        : json(200, { choices: [{ message: { tool_calls: [{ function: { arguments: '{"actions":[{"type":"set-mode","mode":"chatspace"}]}' } }] } }] })
    )
    brain.save({ provider: 'groq', label: '', baseUrl: '', model: 'llama', apiKey: 'k' })
    expect(await brain.plan('chat', ctx, 'ada')).toMatchObject({ actions: [{ type: 'set-mode' }] })
    expect(calls.map((c) => 'reasoning_effort' in c.body)).toEqual([true, false])
    await brain.plan('chat', ctx, 'ada')
    expect(calls.at(-1)!.body.reasoning_effort).toBeUndefined()
  })

  it('speaks Anthropic and Gemini; Gemini keeps the key out of the URL', async () => {
    const a = setup(() => json(200, { content: [{ type: 'tool_use', input: { actions: [{ type: 'navigate', to: 'home' }] } }] }))
    a.brain.save({ provider: 'anthropic', label: '', baseUrl: '', model: 'claude-haiku-4-5', apiKey: 'ak' })
    expect(await a.brain.plan('home', ctx, 'sunny')).toMatchObject({ actions: [{ type: 'navigate', to: 'home' }] })
    expect(a.calls[0]!.body.tool_choice).toEqual({ type: 'tool', name: 'plan' })
    expect((a.calls[0]!.init.headers as Record<string, string>)['x-api-key']).toBe('ak')

    const g = setup(() => json(200, { candidates: [{ content: { parts: [{ functionCall: { name: 'plan', args: { actions: [{ type: 'side-panel', open: true }] } } }] } }] }))
    g.brain.save({ provider: 'gemini', label: '', baseUrl: '', model: 'gemini-flash-latest', apiKey: 'gk-123' })
    expect(await g.brain.plan('panel', ctx, 'frankie')).toMatchObject({ actions: [{ type: 'side-panel', open: true }] })
    expect(g.calls[0]!.url).not.toContain('gk-123')
    expect((g.calls[0]!.init.headers as Record<string, string>)['x-goog-api-key']).toBe('gk-123')
  })

  it('explains failures without leaking the key, and refuses unsafe addresses', async () => {
    const { brain } = setup(() => json(401, { error: { message: 'bad key sk-leak-999' } }))
    brain.save({ provider: 'openai', label: '', baseUrl: '', model: 'm', apiKey: 'sk-leak-999' })
    const error = (await brain.plan('x', ctx, 'ada').catch((e: unknown) => e)) as { message: string }
    expect(error.message).toBe('OpenAI: the provider rejected the API key.')
    expect(JSON.stringify(error)).not.toContain('sk-leak-999')
    expect(() => brain.save({ provider: 'custom', label: 'lan', baseUrl: 'http://10.0.0.2/v1', model: 'm' })).toThrow(/https/)
  })

  it('without a model, planning says so (the renderer then falls back to the rules)', async () => {
    const { brain } = setup(() => json(200, {}))
    await expect(brain.plan('x', ctx, 'ada')).rejects.toMatchObject({ error: { code: 'NOT_FOUND' } })
  })
})
