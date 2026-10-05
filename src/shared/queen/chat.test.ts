import { describe, expect, it } from 'vitest'
import type { QueenContext } from './actions'
import { parseSmallTalk, smallTalkLine } from './chat'
import { parseCommand } from './parse'
import type { QueenPrefs } from './personas'

const prefs = (persona: QueenPrefs['persona']): QueenPrefs => ({ persona, callMe: '', honorific: 'none', hype: 'lively', nudgeMinutes: 10, length: 'normal' })

const ctx: QueenContext = {
  mode: 'workspace',
  projects: [
    { id: 'p1', name: 'api' },
    { id: 'p2', name: 'web' }
  ],
  workspaces: [],
  otherWorkspaces: [
    { id: 'm1', name: 'Main', kind: 'main', projectId: 'p1' },
    { id: 'm2', name: 'Main', kind: 'main', projectId: 'p2' },
    { id: 'f2', name: 'feature-x', kind: 'isolated', projectId: 'p2' }
  ],
  agents: [],
  clis: [{ id: 'codex', displayName: 'Codex', kind: 'agent' }],
  presets: []
}

describe('Queen Bee small talk', () => {
  it('recognises a whole sentence of small talk, never a command', () => {
    expect(parseSmallTalk('Hi')).toBe('greet')
    expect(parseSmallTalk('hello queen bee!')).toBe('greet')
    expect(parseSmallTalk('Good morning')).toBe('greet')
    expect(parseSmallTalk('how are you doing?')).toBe('how-are-you')
    expect(parseSmallTalk('kaise ho')).toBe('how-are-you')
    expect(parseSmallTalk('thanks a lot')).toBe('thanks')
    expect(parseSmallTalk("what's your name?")).toBe('who')
    expect(parseSmallTalk('bye')).toBe('bye')
    expect(parseSmallTalk('hi, open codex')).toBeNull()
    expect(parseSmallTalk('thanks, now close Bruno')).toBeNull()
  })

  it('answers in her personality without a model', () => {
    expect(parseCommand('hey', ctx)).toEqual({ kind: 'actions', actions: [{ type: 'chat', topic: 'greet' }] })
    expect(smallTalkLine('greet', prefs('ada'), 'Ada', new Date(2026, 0, 1, 9))).toBe('Good morning. How may I help?')
    expect(smallTalkLine('who', prefs('sunny'), 'Sunny')).toMatch(/^I'm Sunny/)
    expect(smallTalkLine('thanks', { ...prefs('frankie'), length: 'short' }, 'Frankie')).toBe('Sure.')
  })
})

describe('Queen Bee workspaces across projects', () => {
  it("asks which project's Main when several projects have one", () => {
    const parsed = parseCommand('go to main', ctx)
    expect(parsed.kind).toBe('ask')
    if (parsed.kind !== 'ask') return
    expect(parsed.question.text).toBe("Which project's Main?")
    expect(parsed.question.choices?.map((c) => c.label)).toEqual(['api · Main', 'web · Main'])
    // Each choice parses straight to that project's Main.
    expect(parseCommand(parsed.question.choices![1]!.command, ctx)).toEqual({
      kind: 'actions',
      actions: [{ type: 'navigate', to: 'workspace', projectId: 'p2', workspaceId: 'm2' }]
    })
  })

  it("expects the current project's workspace when you are in one", () => {
    const here: QueenContext = { ...ctx, projectId: 'p1', workspaces: [{ id: 'm1', name: 'Main', kind: 'main' }], otherWorkspaces: ctx.otherWorkspaces!.filter((w) => w.projectId !== 'p1') }
    expect(parseCommand('go to main', here)).toEqual({ kind: 'actions', actions: [{ type: 'navigate', to: 'workspace', projectId: 'p1', workspaceId: 'm1' }] })
    // A name only another project has goes there.
    expect(parseCommand('open feature-x', here)).toEqual({ kind: 'actions', actions: [{ type: 'navigate', to: 'workspace', projectId: 'p2', workspaceId: 'f2' }] })
    expect(parseCommand('show main of web', here)).toEqual({ kind: 'actions', actions: [{ type: 'navigate', to: 'workspace', projectId: 'p2', workspaceId: 'm2' }] })
  })
})
