import { describe, expect, it } from 'vitest'
import type { QueenAction, QueenContext } from './actions'
import { parseCommand } from './parse'

/**
 * Queen Bee's rule tier, as an evaluation set: what people say → exactly what
 * runs. No model involved; every case must be deterministic.
 */
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
    { id: 'a2', petName: 'Luna', cliId: 'codex', workspaceId: 'w1', status: 'idle' },
    { id: 'a3', petName: 'Otis', cliId: 'powershell', workspaceId: 'w1', status: 'idle' },
    { id: 'a4', petName: 'Poppy', cliId: 'claude', workspaceId: 'w2', status: 'waiting-for-you' },
    { id: 'a5', petName: 'Kai', cliId: 'gemini', workspaceId: 'w2', status: 'idle' }
  ],
  clis: [
    { id: 'claude', displayName: 'Claude Code', kind: 'agent' },
    { id: 'codex', displayName: 'Codex', kind: 'agent' },
    { id: 'gemini', displayName: 'Gemini CLI', kind: 'agent' },
    { id: 'powershell', displayName: 'PowerShell', kind: 'shell' }
  ],
  presets: []
}

const send = (agentId: string, text: string): QueenAction => ({ type: 'message-agent', agentId, text })

const CASES: Array<[string, QueenAction[]]> = [
  // A CLI or an agent by name, then the instruction: sent as typed.
  ['codex run the tests', [send('a2', 'run the tests')]],
  ['Codex: fix the login bug, then commit', [send('a2', 'fix the login bug, then commit')]],
  ['@claude summarise your changes', [send('a1', 'summarise your changes')]],
  ['claude code explain the diff in src/app.ts', [send('a1', 'explain the diff in src/app.ts')]],
  ['claude open the settings file and fix it', [send('a1', 'open the settings file and fix it')]],
  ['Bruno, run `pnpm test` and fix what fails', [send('a1', 'run `pnpm test` and fix what fails')]],
  ['gemini review the PR', [send('a5', 'review the PR')]],
  ['powershell npm test', [send('a3', 'npm test')]],
  ['hey queen, ask codex: what changed?', [send('a2', 'what changed?')]],
  ['tell everyone to commit your work', [send('a1', 'commit your work'), send('a2', 'commit your work')]],
  ['everyone: pull the latest main', [send('a1', 'pull the latest main'), send('a2', 'pull the latest main')]],
  ['tell all claude to stop and summarise', [send('a1', 'stop and summarise')]],
  ['open codex and send: add a dark mode toggle', [{ type: 'open-and-message', cliId: 'codex', workspaceId: 'w1', projectId: 'p1', text: 'add a dark mode toggle' }]],

  // Stop work without closing; close only with a yes.
  ['stop Bruno', [{ type: 'interrupt-agent', agentId: 'a1' }]],
  ['interrupt codex', [{ type: 'interrupt-agent', agentId: 'a2' }]],
  ['Bruno ko roko', [{ type: 'interrupt-agent', agentId: 'a1' }]],
  ['codex stop', [{ type: 'interrupt-agent', agentId: 'a2' }]],
  ['close idle agents', [{ type: 'close-agents', agentIds: ['a2'] }]],

  // Status: everything, one CLI, one agent.
  ['status of everything', [{ type: 'report', focus: 'all', everywhere: true }]],
  ['what is happening across projects', [{ type: 'report', focus: 'all', everywhere: true }]],
  ['who is waiting', [{ type: 'report', focus: 'waiting-for-you' }]],
  ['codex status', [{ type: 'agent-detail', agentId: 'a2' }]],
  ['how is codex doing', [{ type: 'agent-detail', agentId: 'a2' }]],
  ['claude status', [{ type: 'agent-detail', agentId: 'a1' }]],
  ['what is Bruno doing?', [{ type: 'agent-detail', agentId: 'a1' }]],
  ['is Luna done?', [{ type: 'agent-detail', agentId: 'a2' }]],
  ['Bruno, are you done?', [{ type: 'agent-detail', agentId: 'a1' }]],
  ['kya chal raha hai', [{ type: 'report', focus: 'all' }]],

  // Go where you are needed.
  ['take me to whoever needs me', [{ type: 'focus-waiting' }]],
  ['next', [{ type: 'focus-waiting' }]],

  // One-liners.
  ['help', [{ type: 'help' }]],
  ['what can you do?', [{ type: 'help' }]],
  ['mute', [{ type: 'speak', on: false }]],
  ['stop talking', [{ type: 'speak', on: false }]],
  ['talk to me', [{ type: 'speak', on: true }]],
  ['jade theme', [{ type: 'set-theme', theme: 'jade' }]],
  ['switch to dark mode', [{ type: 'set-theme', theme: 'dark' }]],
  ['create a workspace called login-fix', [{ type: 'create-workspace', name: 'login-fix', projectId: 'p1' }]],

  // Still commands, even when they start with a CLI name.
  ['codex aur claude kholo', [
    { type: 'open-agents', cliId: 'codex', count: 1, workspaceId: 'w1', projectId: 'p1' },
    { type: 'open-agents', cliId: 'claude', count: 1, workspaceId: 'w1', projectId: 'p1' }
  ]],
  ['open two claude in feature-x', [{ type: 'open-agents', cliId: 'claude', count: 2, workspaceId: 'w2', projectId: 'p1' }]],
  ['show Bruno', [{ type: 'focus-agent', agentId: 'a1', workspaceId: 'w1', projectId: 'p1' }]]
]

describe('Queen Bee commands (rules, no model)', () => {
  it.each(CASES)('%s', (said, expected) => {
    const result = parseCommand(said, ctx)
    expect(result.kind, JSON.stringify(result)).toBe('actions')
    expect(result.kind === 'actions' && result.actions).toEqual(expected)
  })

  it('asks instead of guessing which agent, and offers to open one', () => {
    const two = { ...ctx, agents: [...ctx.agents, { id: 'a6', petName: 'Ruby', cliId: 'codex', workspaceId: 'w1', status: 'idle' as const }] }
    const which = parseCommand('codex run the tests', two)
    expect(which).toMatchObject({ kind: 'ask', question: { text: 'Which Codex?' } })
    expect(which.kind === 'ask' && which.question.choices?.map((c) => c.command)).toEqual(['@Luna run the tests', '@Ruby run the tests', '@all codex run the tests'])
    // The choices themselves run.
    expect(parseCommand('@all codex run the tests', two)).toEqual({ kind: 'actions', actions: [send('a2', 'run the tests'), send('a6', 'run the tests')] })

    const none = { ...ctx, agents: ctx.agents.filter((a) => a.cliId !== 'codex') }
    const offer = parseCommand('codex run the tests', none)
    expect(offer.kind === 'ask' && offer.question.choices?.[0]?.command).toBe('open Codex and send: run the tests')
  })

  it('closing needs a yes; messages from the rules do not (they are the user’s own words)', () => {
    expect(parseCommand('close Luna', ctx)).toMatchObject({ confirm: 'Close Luna?' })
    expect(parseCommand('codex run the tests', ctx)).not.toHaveProperty('confirm')
  })

  it('"everyone" never types into a plain shell', () => {
    const r = parseCommand('everyone: git status', ctx)
    expect(r.kind === 'actions' && r.actions.map((a) => (a as { agentId: string }).agentId)).toEqual(['a1', 'a2'])
  })

  it('answers in well under a millisecond per command', () => {
    const started = performance.now()
    for (let i = 0; i < 50; i++) for (const [said] of CASES) parseCommand(said, ctx)
    expect((performance.now() - started) / (50 * CASES.length)).toBeLessThan(1)
  })
})
