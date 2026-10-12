import { describe, expect, it } from 'vitest'
import type { QueenContext } from './actions'
import { planFromToolArgs } from './brain'
import { parseCommand } from './parse'

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
    { id: 'a1', petName: 'Bruno', cliId: 'claude', workspaceId: 'w1', status: 'idle' },
    { id: 'a2', petName: 'Luna', cliId: 'codex', workspaceId: 'w1', status: 'working' }
  ],
  clis: [
    { id: 'claude', displayName: 'Claude Code', kind: 'agent' },
    { id: 'codex', displayName: 'Codex', kind: 'agent' },
    { id: 'powershell', displayName: 'PowerShell', kind: 'shell' }
  ],
  presets: [{ id: 'pr1', name: 'Fullstack' }],
  bots: [{ id: 'b1', name: 'Scout' }]
}

const actions = (text: string, context: QueenContext = ctx) => {
  const r = parseCommand(text, context)
  if (r.kind !== 'actions') throw new Error(`"${text}" → ${JSON.stringify(r)}`)
  return r.actions
}

describe('Queen Bee app commands', () => {
  it('turns settings on and off', () => {
    expect(actions('turn off browser use')).toEqual([{ type: 'set-setting', setting: 'browser-use', on: false }])
    expect(actions('enable computer use')).toEqual([{ type: 'set-setting', setting: 'computer-use', on: true }])
    expect(actions('queen, auto approve on')).toEqual([{ type: 'set-setting', setting: 'auto-approve', on: true }])
  })

  it('opens pages in the browser and files in an editor, and tells them apart', () => {
    expect(actions('open github.com')).toEqual([{ type: 'open-url', url: 'https://github.com', workspaceId: 'w1' }])
    expect(actions('go to localhost:3000/login')).toEqual([{ type: 'open-url', url: 'http://localhost:3000/login', workspaceId: 'w1' }])
    expect(actions('open README.md')).toEqual([{ type: 'open-file', query: 'README.md', workspaceId: 'w1' }])
    expect(actions('open file package.json')).toEqual([{ type: 'open-file', query: 'package.json', workspaceId: 'w1' }])
    // A workspace by name still navigates.
    expect(actions('open feature-x')).toEqual([{ type: 'navigate', to: 'workspace', projectId: 'p1', workspaceId: 'w2' }])
  })

  it('reports Git, pull requests, apps and updates', () => {
    expect(actions('what changed')).toEqual([{ type: 'git-status', workspaceId: 'w1' }])
    expect(actions('which branch am I on')).toEqual([{ type: 'git-status', workspaceId: 'w1' }])
    expect(actions('show open PRs')).toEqual([{ type: 'pull-requests', projectId: 'p1' }])
    expect(actions('which apps are connected')).toEqual([{ type: 'apps-report' }])
    expect(actions('open apps settings')).toEqual([{ type: 'navigate', to: 'settings', section: 'extensions' }])
    expect(actions('check for updates')).toEqual([{ type: 'check-updates' }])
  })

  it('arranges panes, saves presets and adds projects', () => {
    expect(actions('tidy up the panes')).toEqual([{ type: 'arrange', layout: 'equal', workspaceId: 'w1' }])
    expect(actions('arrange agents side by side')).toEqual([{ type: 'arrange', layout: 'columns', workspaceId: 'w1' }])
    expect(actions('save this as preset Backend')).toEqual([{ type: 'save-preset', name: 'Backend', workspaceId: 'w1' }])
    expect(actions('add a project')).toEqual([{ type: 'add-project' }])
  })

  it('lays panes out, swaps, moves and resizes them by agent name (ADR 0048)', () => {
    const arrange = (layout: string, extra = {}) => [{ type: 'arrange', layout, workspaceId: 'w1', ...extra }]
    expect(actions('arrange them in a grid')).toEqual(arrange('equal'))
    expect(actions('put the panes in a grid')).toEqual(arrange('equal'))
    expect(actions('grid layout')).toEqual(arrange('equal'))
    expect(actions('can you tile the panels')).toEqual(arrange('equal'))
    expect(actions('stack the agents')).toEqual(arrange('rows'))
    expect(actions('show them in rows')).toEqual(arrange('rows'))
    expect(actions('lay out panes in columns')).toEqual(arrange('columns'))
    expect(actions('make Bruno the main pane')).toEqual(arrange('focus', { agentId: 'a1' }))
    expect(actions('give Luna half the screen')).toEqual(arrange('focus', { agentId: 'a2' }))
    expect(actions('swap Bruno and Luna')).toEqual([{ type: 'swap-panes', agentId: 'a1', targetAgentId: 'a2' }])
    expect(actions('move Luna to the left')).toEqual([{ type: 'move-pane', agentId: 'a2', side: 'left' }])
    expect(actions('put Bruno below Luna')).toEqual([{ type: 'move-pane', agentId: 'a1', side: 'bottom', targetAgentId: 'a2' }])
    expect(actions('make Bruno bigger')).toEqual([{ type: 'resize-pane', agentId: 'a1', size: 'bigger' }])
    expect(actions('make Luna narrower')).toEqual([{ type: 'resize-pane', agentId: 'a2', size: 'narrower' }])
    // Messages stay messages, and "focus Bruno" still jumps to the pane.
    expect(actions('tell Bruno to make the logo bigger')).toEqual([{ type: 'message-agent', agentId: 'a1', text: 'make the logo bigger' }])
    expect(actions('focus Bruno')).toEqual([{ type: 'focus-agent', agentId: 'a1', workspaceId: 'w1', projectId: 'p1' }])
    expect(parseCommand('arrange them in a grid', { ...ctx, workspaceId: undefined })).toMatchObject({ kind: 'ask' })
    // A model may name the agents and say "grid".
    expect(planFromToolArgs({ actions: [{ type: 'arrange', layout: 'grid' }, { type: 'swap-panes', agentId: 'Bruno', targetAgentId: 'luna' }] }, ctx)).toEqual({
      kind: 'actions',
      actions: [...arrange('equal'), { type: 'swap-panes', agentId: 'a1', targetAgentId: 'a2' }]
    })
  })

  it('starts chats, messages bots and resumes sessions', () => {
    expect(actions('new chat')).toEqual([{ type: 'new-chat', projectId: 'p1' }])
    expect(actions('start a chat with codex about the API design')).toEqual([{ type: 'new-chat', cliId: 'codex', text: 'the API design', projectId: 'p1' }])
    // "open chat" still switches to Chat mode.
    expect(actions('open chat')).toEqual([{ type: 'set-mode', mode: 'chatspace' }])
    expect(actions('ask Scout to summarize my inbox')).toEqual([{ type: 'message-bot', botId: 'b1', text: 'summarize my inbox' }])
    // An agent's name wins over a bot's.
    expect(actions('tell Bruno to run the tests')).toEqual([{ type: 'message-agent', agentId: 'a1', text: 'run the tests' }])
    expect(actions('resume my last claude session')).toEqual([{ type: 'resume-session', cliId: 'claude', workspaceId: 'w1', projectId: 'p1' }])
    expect(parseCommand('resume', ctx)).toMatchObject({ kind: 'ask', question: { text: 'Which CLI should I resume?' } })
  })

  it('restarts every agent at once', () => {
    expect(actions('restart all')).toEqual([
      { type: 'restart-agent', agentId: 'a1' },
      { type: 'restart-agent', agentId: 'a2' }
    ])
  })

  it('needs a workspace for workspace things', () => {
    const home: QueenContext = { ...ctx, projectId: undefined, workspaceId: undefined }
    expect(parseCommand('what changed', home)).toMatchObject({ kind: 'ask' })
    expect(parseCommand('open github.com', home)).toMatchObject({ kind: 'ask' })
  })

  it('accepts the new actions from a model, checks their ids and asks before acting on its own words', () => {
    expect(planFromToolArgs({ actions: [{ type: 'git-status' }] }, ctx)).toEqual({ kind: 'actions', actions: [{ type: 'git-status', workspaceId: 'w1' }] })
    expect(planFromToolArgs({ actions: [{ type: 'open-url', url: 'example.com' }] }, ctx)).toEqual({
      kind: 'actions',
      actions: [{ type: 'open-url', url: 'https://example.com', workspaceId: 'w1' }]
    })
    expect(planFromToolArgs({ actions: [{ type: 'message-bot', botId: 'Scout', text: 'hello there' }] }, ctx, 'ask scout to say hi')).toMatchObject({
      kind: 'actions',
      actions: [{ type: 'message-bot', botId: 'b1', text: 'hello there' }],
      confirm: 'Send to Scout: “hello there”?'
    })
    expect(planFromToolArgs({ actions: [{ type: 'message-bot', botId: 'Ghost', text: 'hi' }] }, ctx)).toEqual({ kind: 'unknown' })
    expect(planFromToolArgs({ actions: [{ type: 'set-setting', setting: 'computer-use', on: 'true' }] }, ctx)).toMatchObject({ confirm: 'Turn computer use on?' })
    expect(planFromToolArgs({ actions: [{ type: 'open-url', url: 'javascript:alert(1)' }] }, ctx)).toEqual({ kind: 'unknown' })
  })

  it('opens Bots pages and pauses or resumes routines and triggers by name', () => {
    const withAutomations: QueenContext = {
      ...ctx,
      automations: [
        { id: 'r1', name: 'Morning brief', kind: 'routine', on: true },
        { id: 't1', name: 'New issue', kind: 'trigger', on: false },
        { id: 'r2', name: 'Digest', kind: 'routine', on: true },
        { id: 't2', name: 'Digest', kind: 'trigger', on: true },
        { id: 'r3', name: 'Bruno', kind: 'routine', on: true }
      ]
    }
    expect(actions('open the work board')).toEqual([{ type: 'navigate', to: 'bots', page: 'work' }])
    expect(actions('go to routines')).toEqual([{ type: 'navigate', to: 'bots', page: 'routines' }])
    expect(actions('open schedules')).toEqual([{ type: 'navigate', to: 'bots', page: 'routines' }])
    expect(actions('pause the morning brief schedule', withAutomations)).toEqual([{ type: 'switch-automation', automationId: 'r1', on: false }])
    expect(actions('show the team map')).toEqual([{ type: 'navigate', to: 'bots', page: 'team-map' }])
    expect(actions('pause Morning brief', withAutomations)).toEqual([{ type: 'switch-automation', automationId: 'r1', on: false }])
    expect(actions('resume the morning brief routine', withAutomations)).toEqual([{ type: 'switch-automation', automationId: 'r1', on: true }])
    expect(actions('turn the New issue trigger back on', withAutomations)).toEqual([{ type: 'switch-automation', automationId: 't1', on: true }])
    expect(actions('pause digest trigger', withAutomations)).toEqual([{ type: 'switch-automation', automationId: 't2', on: false }])
    expect(parseCommand('pause digest', withAutomations)).toMatchObject({ kind: 'ask', question: { choices: [{ command: 'pause Digest schedule' }, { command: 'pause Digest trigger' }] } })
    // An agent with the same name wins.
    expect(actions('stop Bruno', withAutomations)).toEqual([{ type: 'interrupt-agent', agentId: 'a1' }])
    // A model may switch them too, but only ids it was shown, and only after a yes.
    expect(planFromToolArgs({ actions: [{ type: 'switch-automation', automationId: 'Morning brief', on: false }] }, withAutomations)).toMatchObject({
      actions: [{ type: 'switch-automation', automationId: 'r1', on: false }],
      confirm: 'Turn Morning brief off?'
    })
    expect(planFromToolArgs({ actions: [{ type: 'switch-automation', automationId: 'Ghost', on: true }] }, withAutomations)).toEqual({ kind: 'unknown' })
    expect(planFromToolArgs({ actions: [{ type: 'navigate', page: 'triggers' }] }, ctx)).toEqual({ kind: 'actions', actions: [{ type: 'navigate', to: 'bots', page: 'triggers' }] })
  })
})
