import { describe, expect, it } from 'vitest'
import type { QueenContext } from './actions'
import { planFromToolArgs } from './brain'
import { QUEEN_CAPABILITIES } from './capabilities'
import { helpLine } from './personas'

/** Model plans of several steps (ADR 0019 amendment): each step is read where the earlier ones lead. */
const ctx: QueenContext = {
  mode: 'workspace',
  projectId: 'p1',
  workspaceId: 'w1',
  projects: [
    { id: 'p1', name: 'coding vibes' },
    { id: 'p2', name: 'demo website' }
  ],
  workspaces: [{ id: 'w1', name: 'Main', kind: 'main' }],
  otherWorkspaces: [{ id: 'w9', name: 'Main', kind: 'main', projectId: 'p2' }],
  agents: [],
  clis: [{ id: 'claude', displayName: 'Claude Code', kind: 'agent' }],
  presets: []
}

describe('Queen Bee plans of several steps', () => {
  it('open another workspace, make a worktree there, open two Claude in it, side by side', () => {
    const plan = planFromToolArgs(
      {
        actions: [
          { type: 'navigate', to: 'project', projectId: 'demo website' },
          { type: 'create-workspace', name: 'secondary' },
          { type: 'open-agents', cliId: 'Claude Code', count: 2, workspaceId: 'secondary' },
          { type: 'arrange', layout: 'columns' }
        ]
      },
      ctx
    )
    expect(plan).toMatchObject({
      kind: 'actions',
      actions: [
        { type: 'navigate', to: 'project', projectId: 'p2' },
        { type: 'create-workspace', name: 'secondary', projectId: 'p2' },
        { type: 'open-agents', cliId: 'claude', count: 2, workspaceId: 'new:secondary', projectId: 'p2' },
        { type: 'arrange', layout: 'columns', workspaceId: 'new:secondary' }
      ]
    })
  })

  it('after going to a workspace, a step without a worktree acts in its primary one', () => {
    const plan = planFromToolArgs({ actions: [{ type: 'navigate', to: 'project', projectId: 'p2' }, { type: 'open-agents', cliId: 'claude' }] }, ctx)
    expect(plan).toMatchObject({ actions: [{}, { type: 'open-agents', workspaceId: 'w9', projectId: 'p2', count: 1 }] })
  })

  it('a worktree no earlier step created still fails', () => {
    expect(planFromToolArgs({ actions: [{ type: 'open-agents', cliId: 'claude', workspaceId: 'new:ghost' }] }, ctx)).toEqual({ kind: 'unknown' })
    expect(planFromToolArgs({ actions: [{ type: 'arrange', layout: 'columns', workspaceId: 'ghost' }] }, ctx)).toEqual({ kind: 'unknown' })
  })

  it('her help answer is the capability reference, one line per area, in her voice', () => {
    const prefs = { persona: 'frankie', callMe: '' } as Parameters<typeof helpLine>[0]
    const lines = helpLine(prefs).split('\n')
    expect(lines).toHaveLength(QUEEN_CAPABILITIES.length + 2)
    for (const c of QUEEN_CAPABILITIES) expect(lines.some((l) => l.startsWith(`• ${c.area}`))).toBe(true)
  })

  it('a model that "navigates" to a mode still gets there', () => {
    expect(planFromToolArgs({ actions: [{ type: 'navigate', to: 'bots' }] }, ctx)).toMatchObject({ actions: [{ type: 'navigate', to: 'bots', page: 'work' }] })
    expect(planFromToolArgs({ actions: [{ type: 'navigate', to: 'chat' }] }, ctx)).toMatchObject({ actions: [{ type: 'set-mode', mode: 'chatspace' }] })
    expect(planFromToolArgs({ actions: [{ type: 'set-mode', mode: 'bots' }] }, ctx)).toMatchObject({ actions: [{ type: 'set-mode', mode: 'bots' }] })
  })
})
