import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { QueenContext } from '@shared/queen/actions'
import { planFromToolArgs } from '@shared/queen/brain'
import { SecretBox, type Sealer } from '../connections/secret-box'
import { StateStore } from '../persistence/state-store'
import { jsonIn, QueenBrain } from './queen-brain'

const log = { info: () => undefined, warn: () => undefined, error: () => undefined }
const sealer: Sealer = { isEncryptionAvailable: () => true, encryptString: (v) => Buffer.from(v), decryptString: (b) => b.toString() }
const ADA = { name: 'Ada', tagline: 'Strict' }

const ctx: QueenContext = {
  mode: 'workspace',
  projectId: 'p1',
  workspaceId: 'w1',
  projects: [{ id: 'p1', name: 'demo-app' }],
  workspaces: [
    { id: 'w1', name: 'Main', kind: 'main' },
    { id: 'w2', name: 'feature-x', kind: 'isolated' }
  ],
  agents: [
    { id: 'a1', petName: 'Bruno', cliId: 'claude', workspaceId: 'w1', status: 'working' },
    { id: 'a2', petName: 'Luna', cliId: 'codex', workspaceId: 'w2', status: 'idle' }
  ],
  clis: [
    { id: 'claude', displayName: 'Claude Code' },
    { id: 'codex', displayName: 'Codex' }
  ],
  presets: [{ id: 'pr1', name: 'Fullstack' }]
}

/**
 * Whatever model plans, the result is exact: names become ids only on an exact
 * match, derivable fields are filled the way the rules fill them, and anything
 * still wrong runs nothing. These are the mistakes real models make.
 */
describe('Queen Bee model plans: repaired, never guessed', () => {
  it('fills what follows from the request (a real provider left out the Settings section)', () => {
    expect(planFromToolArgs({ actions: [{ type: 'navigate', to: 'settings' }] }, ctx)).toEqual({ kind: 'actions', actions: [{ type: 'navigate', to: 'settings', section: 'appearance' }] })
    expect(planFromToolArgs({ actions: [{ type: 'focus-agent', agentId: 'a2' }] }, ctx)).toEqual({
      kind: 'actions',
      actions: [{ type: 'focus-agent', agentId: 'a2', workspaceId: 'w2', projectId: 'p1' }]
    })
    expect(planFromToolArgs({ actions: [{ type: 'open-agents', cliId: 'codex' }] }, ctx)).toEqual({
      kind: 'actions',
      actions: [{ type: 'open-agents', cliId: 'codex', count: 1, workspaceId: 'w1', projectId: 'p1' }]
    })
  })

  it('accepts exact names for ids, misspelled action types and string numbers', () => {
    expect(planFromToolArgs({ actions: [{ type: 'open_agents', cliId: 'Claude Code', count: '2', workspaceId: 'feature-x' }] }, ctx)).toEqual({
      kind: 'actions',
      actions: [{ type: 'open-agents', cliId: 'claude', count: 2, workspaceId: 'w2', projectId: 'p1' }]
    })
    expect(planFromToolArgs({ actions: [{ type: 'Stop', agentId: 'bruno' }] }, ctx)).toEqual({ kind: 'actions', actions: [{ type: 'interrupt-agent', agentId: 'a1' }] })
    expect(planFromToolArgs({ actions: [{ type: 'report', focus: 'waiting' }] }, ctx)).toEqual({ kind: 'actions', actions: [{ type: 'report', focus: 'waiting-for-you' }] })
  })

  it('never guesses: an unknown name, a wrong type or a near miss runs nothing', () => {
    expect(planFromToolArgs({ actions: [{ type: 'interrupt-agent', agentId: 'Brunoo' }] }, ctx)).toEqual({ kind: 'unknown' })
    expect(planFromToolArgs({ actions: [{ type: 'open-agents', cliId: 'aider' }] }, ctx)).toEqual({ kind: 'unknown' })
    expect(planFromToolArgs({ actions: [{ type: 'format-disk' }] }, ctx)).toEqual({ kind: 'unknown' })
    expect(planFromToolArgs({ actions: [{ type: 'set-theme', theme: 'neon' }] }, ctx)).toEqual({ kind: 'unknown' })
  })

  it('the user’s own words go straight through; a model’s rewording needs a yes', () => {
    const said = 'please have bruno run the unit tests'
    expect(planFromToolArgs({ actions: [{ type: 'message-agent', agentId: 'Bruno', text: 'run the unit tests' }] }, ctx, said)).not.toHaveProperty('confirm')
    expect(planFromToolArgs({ actions: [{ type: 'message-agent', agentId: 'Bruno', text: 'Please execute the unit test suite.' }] }, ctx, said)).toMatchObject({
      confirm: 'Send to Bruno: “Please execute the unit test suite.”?'
    })
    expect(planFromToolArgs({ actions: [{ type: 'create-workspace', name: 'login-fix' }] }, ctx)).toMatchObject({ confirm: 'Create the worktree “login-fix”?' })
  })

  it('reads JSON out of a text answer (thinking blocks and fences dropped)', () => {
    expect(jsonIn('<think>the user wants…{not json}</think>\n```json\n{"actions":[{"type":"help"}]}\n```')).toBe('{"actions":[{"type":"help"}]}')
    expect(jsonIn('no json here')).toBe('')
  })
})

describe('Queen Bee and providers that refuse parts of a request', () => {
  const setup = (respond: (body: Record<string, unknown>) => Response) => {
    const store = new StateStore(join(mkdtempSync(join(tmpdir(), 'hv-acc-')), 'state.json'), log)
    const bodies: Array<Record<string, unknown>> = []
    const http = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>
      bodies.push(body)
      return respond(body)
    }) as unknown as typeof fetch
    const brain = new QueenBrain(store, new SecretBox(sealer), http)
    brain.save({ provider: 'custom', label: 'Odd', kind: 'openai', baseUrl: 'https://odd.example/v1', model: 'qwen-3.8-27b', apiKey: 'k' })
    return { brain, bodies }
  }
  const ok = (message: Record<string, unknown>) => new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 })
  const refuse = (error: string) => new Response(JSON.stringify({ error: { message: error } }), { status: 400 })

  it('steps down: no hint → any tool call → a plain JSON answer, and remembers what worked', async () => {
    const { brain, bodies } = setup((body) => {
      if (body.reasoning_effort) return refuse('Unrecognized request argument: reasoning_effort')
      if (typeof body.tool_choice === 'object') return refuse('tool_choice must be "auto" or "required"')
      if (body.tools) return refuse('This model does not support tools')
      return ok({ content: '<think>hm</think>{"actions":[{"type":"set-mode","mode":"chat"}]}' })
    })
    expect(await brain.plan('switch to the chat view please', ctx, ADA)).toEqual({ kind: 'actions', actions: [{ type: 'set-mode', mode: 'chatspace' }] })
    expect(bodies.length).toBe(4)
    expect(bodies[3]!.tools).toBeUndefined()
    // Next time it asks the way that worked, once.
    await brain.plan('switch to the chat view please', ctx, ADA)
    expect(bodies.length).toBe(5)
  })

  it('a provider that is just down is reported as it is', async () => {
    const { brain } = setup(() => new Response('boom', { status: 503 }))
    await expect(brain.plan('x', ctx, ADA)).rejects.toThrow(/provider had an error/)
  })
})
