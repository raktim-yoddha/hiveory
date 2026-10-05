import { describe, expect, it } from 'vitest'
import { PET_NAMES } from '../naming/names'
import type { QueenContext } from './actions'
import { parseCommand } from './parse'
import { stateMessage, systemPrompt } from './brain'
import { customNameProblem, doneLine, PERSONA_NAMES, personaCore, recallLine, reportLine, type QueenPrefs } from './personas'
import { buildReport } from './report'
import { QUEEN_VOICES, sentencesOf, speakable, voiceFor } from './voice'

const ctx: QueenContext = {
  mode: 'workspace',
  projectId: 'p1',
  workspaceId: 'w1',
  projects: [{ id: 'p1', name: 'demo-app' }, { id: 'p2', name: 'billing-api' }],
  workspaces: [
    { id: 'w1', name: 'Main', kind: 'main' },
    { id: 'w2', name: 'feature-x', kind: 'isolated' },
    { id: 'w3', name: 'feature-y', kind: 'isolated' }
  ],
  agents: [
    { id: 'a1', petName: 'Bruno', cliId: 'claude', workspaceId: 'w1' },
    { id: 'a2', petName: 'Luna', cliId: 'codex', workspaceId: 'w1' },
    { id: 'a3', petName: 'Poppy', cliId: 'claude', workspaceId: 'w2' }
  ],
  clis: [
    { id: 'claude', displayName: 'Claude Code' },
    { id: 'codex', displayName: 'Codex' },
    { id: 'kimi', displayName: 'Kimi CLI' },
    { id: 'powershell', displayName: 'PowerShell' }
  ],
  presets: [{ id: 'pr1', name: 'Fullstack' }, { id: 'pr2', name: 'Review squad' }]
}

const actions = (text: string) => {
  const r = parseCommand(text, ctx)
  if (r.kind !== 'actions') throw new Error(`"${text}" → ${JSON.stringify(r)}`)
  return r.actions
}

describe('Queen Bee rule parser', () => {
  it('opens agents with counts, aliases and workspaces', () => {
    expect(actions('open two claude')).toEqual([{ type: 'open-agents', cliId: 'claude', count: 2, workspaceId: 'w1', projectId: 'p1' }])
    expect(actions('Hey queen, please spin up 3 Codex in feature-x')).toEqual([{ type: 'open-agents', cliId: 'codex', count: 3, workspaceId: 'w2', projectId: 'p1' }])
    expect(actions('launch a claude code and a kimi')).toEqual([
      { type: 'open-agents', cliId: 'claude', count: 1, workspaceId: 'w1', projectId: 'p1' },
      { type: 'open-agents', cliId: 'kimi', count: 1, workspaceId: 'w1', projectId: 'p1' }
    ])
    expect(actions('open 2 claudes on main')[0]).toMatchObject({ cliId: 'claude', count: 2, workspaceId: 'w1' })
    expect(actions('give me powershell')[0]).toMatchObject({ cliId: 'powershell' })
  })

  it('asks instead of guessing', () => {
    expect(parseCommand('open claude in feature', ctx)).toMatchObject({ kind: 'ask', question: { text: 'Which workspace do you mean?' } })
    expect(parseCommand('open claude in nowhere', ctx)).toMatchObject({ kind: 'ask' })
    expect(parseCommand('open 12 codex', ctx)).toMatchObject({ kind: 'ask' })
    expect(parseCommand('close', ctx)).toMatchObject({ kind: 'ask', question: { choices: [{ command: 'close Bruno' }, { command: 'close Luna' }] } })
    expect(parseCommand('open an agent', ctx)).toMatchObject({ kind: 'ask', question: { text: 'Which agent should I open?' } })
    expect(parseCommand('open claude', { ...ctx, workspaceId: undefined })).toMatchObject({ kind: 'ask' })
  })

  it('closes with confirmation, one question for several names', () => {
    expect(parseCommand('close Bruno and Luna', ctx)).toEqual({ kind: 'actions', actions: [{ type: 'close-agents', agentIds: ['a1', 'a2'] }], confirm: 'Close Bruno, Luna?' })
    expect(parseCommand('kill all codex', ctx)).toMatchObject({ actions: [{ type: 'close-agents', agentIds: ['a2'] }] })
    expect(parseCommand('close everyone', ctx)).toMatchObject({ actions: [{ type: 'close-agents', agentIds: ['a1', 'a2'] }] })
  })

  it('finds agents, workspaces, projects and pages', () => {
    expect(actions('go to poppy')).toEqual([{ type: 'focus-agent', agentId: 'a3', workspaceId: 'w2', projectId: 'p1' }])
    expect(actions('show me Bruno')[0]).toMatchObject({ type: 'focus-agent', agentId: 'a1' })
    expect(actions('restart luna')).toEqual([{ type: 'restart-agent', agentId: 'a2' }])
    expect(actions('take me to feature-y')).toEqual([{ type: 'navigate', to: 'workspace', projectId: 'p1', workspaceId: 'w3' }])
    expect(actions('open billing api')).toEqual([{ type: 'navigate', to: 'project', projectId: 'p2' }])
    expect(actions('go home')).toEqual([{ type: 'navigate', to: 'home' }])
    expect(actions('open settings')).toEqual([{ type: 'navigate', to: 'settings', section: 'appearance' }])
    expect(actions('open plugin settings')).toEqual([{ type: 'navigate', to: 'settings', section: 'extensions' }])
    expect(actions('configure the queen')).toEqual([{ type: 'navigate', to: 'settings', section: 'queen' }])
    expect(actions('switch to chat')).toEqual([{ type: 'set-mode', mode: 'chatspace' }])
    expect(actions('work mode')).toEqual([{ type: 'set-mode', mode: 'workspace' }])
    expect(actions('open the browser')).toEqual([{ type: 'open-panel-tab', kind: 'browser' }])
    expect(actions('show file explorer')).toEqual([{ type: 'open-panel-tab', kind: 'explorer' }])
    expect(actions('hide the side panel')).toEqual([{ type: 'side-panel', open: false }])
    expect(actions('load preset fullstack in feature-x')).toEqual([{ type: 'apply-preset', presetId: 'pr1', workspaceId: 'w2', projectId: 'p1' }])
  })

  it('chains clauses and runs nothing when any clause is unclear', () => {
    expect(actions('open 2 codex then switch to chat').map((a) => a.type)).toEqual(['open-agents', 'set-mode'])
    expect(parseCommand('open 2 codex and write me a poem', ctx)).toEqual({ kind: 'unknown' })
  })

  it('understands Hinglish, verb last included', () => {
    expect(actions('do codex kholo')).toEqual([{ type: 'open-agents', cliId: 'codex', count: 2, workspaceId: 'w1', projectId: 'p1' }])
    expect(actions('Do Codex Kolo')).toMatchObject([{ cliId: 'codex', count: 2 }])
    expect(actions('settings dikhao')).toEqual([{ type: 'navigate', to: 'settings', section: 'appearance' }])
    expect(actions('teen claude chalu karo aur chat mode pe jao').map((a) => a.type)).toEqual(['open-agents', 'set-mode'])
    expect(parseCommand('bruno ko band karo', ctx)).toMatchObject({ actions: [{ type: 'close-agents', agentIds: ['a1'] }], confirm: 'Close Bruno?' })
    expect(actions('kya chal raha hai')).toEqual([{ type: 'report', focus: 'all' }])
    expect(actions('kaun wait kar raha hai')).toEqual([{ type: 'report', focus: 'waiting-for-you' }])
  })

  it('reads reports with their focus', () => {
    expect(actions("what's left?")).toEqual([{ type: 'report', focus: 'all' }])
    expect(actions('who is waiting')).toEqual([{ type: 'report', focus: 'waiting-for-you' }])
    expect(actions('is anyone stuck?')).toEqual([{ type: 'report', focus: 'waiting-for-you' }])
    expect(actions('status')).toEqual([{ type: 'report', focus: 'all' }])
  })
})

describe('Queen Bee personas', () => {
  const prefs = (persona: QueenPrefs['persona']): QueenPrefs => ({ persona, callMe: 'Raktim', honorific: 'sir', hype: 'lively', nudgeMinutes: 10, length: 'normal' })

  it('phrases the same facts in each voice', () => {
    const opened = [{ kind: 'opened' as const, count: 2, cliName: 'Codex', workspace: 'feature-x' }]
    expect(doneLine(opened, prefs('ada'))).toBe('Done, sir. Two Codex agents are starting in feature-x.')
    expect(doneLine(opened, prefs('sunny'))).toBe('On it! 2 Codex agents are starting in feature-x.')
    expect(doneLine(opened, prefs('frankie'))).toBe('2 Codex agents are starting in feature-x. Give each one a single clear task.')
    expect(doneLine(opened, { ...prefs('ada'), length: 'short' })).toBe('Done, sir.')
  })

  it('reports computed numbers, longest wait first', () => {
    const r = buildReport(
      [
        { id: 'a', petName: 'Bruno', cliName: 'Claude Code', workspaceName: 'Main', status: 'waiting-for-you', waitingMinutes: 4 },
        { id: 'b', petName: 'Luna', cliName: 'Codex', workspaceName: 'feature-x', status: 'waiting-for-you', waitingMinutes: 14 },
        { id: 'c', petName: 'Poppy', cliName: 'Codex', workspaceName: 'Main', status: 'working' }
      ],
      'all'
    )
    expect(r.waiting.map((a) => a.petName)).toEqual(['Luna', 'Bruno'])
    expect(reportLine(r, prefs('ada'))).toBe('2 waiting for you, 1 working, 0 idle, sir. Luna in feature-x has been waiting for 14 min.')
    expect(reportLine(r, prefs('frankie'))).toBe("Raktim, Luna has waited on you for 14 min. That's the bottleneck, not the agents. Answer it and the hive moves again.")
  })

  it('persona names are never agent pet names', () => {
    for (const name of PERSONA_NAMES) {
      expect(PET_NAMES).not.toContain(name)
    }
  })
})

describe('Queen Bee memory commands', () => {
  it('notes facts in the user’s own words, forgets and recalls them', () => {
    expect(actions('Remember that I review PRs with Claude')).toEqual([{ type: 'remember', text: 'I review PRs with Claude' }])
    expect(actions('queen, note down: staging is on port 4000')).toEqual([{ type: 'remember', text: 'staging is on port 4000' }])
    expect(actions('yaad rakho main subah kaam karta hoon')).toEqual([{ type: 'remember', text: 'main subah kaam karta hoon' }])
    expect(actions('forget about staging.')).toEqual([{ type: 'forget', text: 'staging' }])
    expect(actions('what do you know about me?')).toEqual([{ type: 'recall' }])
    // "remember to …" is a reminder, not a fact: not a note.
    expect(parseCommand('remember to run the tests', ctx).kind).not.toBe('actions')
    expect(parseCommand(`remember that ${'x'.repeat(300)}`, ctx).kind).toBe('ask')
  })

  it('a custom personality answers to her own name', () => {
    const named = { ...ctx, queenName: 'Zara' }
    expect(parseCommand('Zara, open two codex', named)).toMatchObject({ actions: [{ type: 'open-agents', cliId: 'codex', count: 2 }] })
    expect(parseCommand('hey zara remember that I like tabs', named)).toMatchObject({ actions: [{ type: 'remember', text: 'I like tabs' }] })
  })
})

describe('Queen Bee custom personality', () => {
  const base: QueenPrefs = { persona: 'custom', callMe: '', honorific: 'none', hype: 'lively', nudgeMinutes: 10, length: 'normal' }
  const opened = [{ kind: 'opened' as const, count: 2, cliName: 'Codex', workspace: 'feature-x' }]

  it('borrows the phrasing of the slider pushed furthest', () => {
    expect(personaCore({ ...base, custom: { formal: 90, energy: 40, direct: 20 } })).toBe('ada')
    expect(personaCore({ ...base, custom: { formal: 20, energy: 40, direct: 80 } })).toBe('frankie')
    expect(personaCore({ ...base, custom: { formal: 20, energy: 30, direct: 10 } })).toBe('sunny')
    expect(doneLine(opened, { ...base, custom: { formal: 10, energy: 90, direct: 10 } })).toBe("Let's go! 2 Codex agents are starting in feature-x!")
    expect(doneLine(opened, { ...base, custom: { formal: 20, energy: 10, direct: 30 } })).toBe('Done. 2 Codex agents are starting in feature-x.')
  })

  it('refuses names that would clash with agents or the built-in personalities', () => {
    expect(customNameProblem('Zara')).toBeNull()
    expect(customNameProblem('Bruno')).toMatch(/agent name/)
    expect(customNameProblem('ada')).toMatch(/built-in/)
    expect(customNameProblem('Queen')).toMatch(/Queen Bee/)
    expect(customNameProblem('R2-D2')).toMatch(/letters/)
  })

  it('Frankie keeps the goal in view and pushes harder when asked', () => {
    const r = buildReport([{ id: 'c', petName: 'Poppy', cliName: 'Codex', workspaceName: 'Main', status: 'idle' }], 'all')
    const frankie: QueenPrefs = { ...base, persona: 'frankie', goal: 'Ship the beta by Friday', intensity: 'hard' }
    expect(reportLine(r, frankie)).toBe('1 agent idle. Idle agents ship nothing. Give them work now. Goal: Ship the beta by Friday.')
  })

  it('reads notes back', () => {
    expect(recallLine(['I like tabs.', 'staging is on 4000'], { ...base, persona: 'frankie' })).toBe('2 notes: I like tabs; staging is on 4000.')
  })

  it('the model prompt carries the user’s style text as tone only, and notes as facts', () => {
    const system = systemPrompt({ name: 'Zara', tagline: 'Your own', text: 'Witty and warm.' })
    expect(system).toContain("Zara's style, written by the user (tone only")
    expect(system).toContain('Witty and warm.')
    expect(stateMessage(ctx, 'hi', ['I like tabs'])).toContain('NOTES\n- I like tabs')
  })
})

describe('Queen Bee speaking', () => {
  it('says only the first two sentences, without symbols a voice would read out', () => {
    expect(speakable('Done, sir. Two Codex agents are starting in feature-x. Give each one a task.')).toBe('Done, sir. Two Codex agents are starting in feature-x.')
    expect(speakable('Try: “codex run the tests”, *stop Bruno*')).toBe('Try: codex run the tests, stop Bruno')
    expect(sentencesOf('Done. Luna has finished! Bruno needs you?')).toEqual(['Done.', 'Luna has finished!', 'Bruno needs you?'])
  })

  it('offers four distinct voices; a voice from the old, longer list falls back to the personality’s own', () => {
    expect(QUEEN_VOICES.map((v) => v.name)).toEqual(['Heart', 'Bella', 'Emma', 'Michael'])
    expect(new Set(QUEEN_VOICES.map((v) => v.sid)).size).toBe(4)
    expect(voiceFor({ queenPersona: 'ada', queenVoice: 7 }).name).toBe('Emma')
    expect(voiceFor({ queenPersona: 'sunny', queenVoice: 16 }).name).toBe('Michael')
  })
})
