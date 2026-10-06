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
})
