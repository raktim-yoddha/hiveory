import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type Project, type Workspace } from '@shared/domain'
import { agentPrompt } from '../cli/adapters/mcp-injection'
import { AboutTools } from './about-tools'

const project = { id: 'p', name: 'web', path: '/home/me/web', settings: { codeHost: 'gitlab', issueSource: 'linear' } } as Project
const worktree = { id: 'w', projectId: 'p', name: 'login', kind: 'isolated', path: '/home/me/web-login', git: { branch: 'hiveory/login' } } as Workspace

describe('hiveory_about', () => {
  const tools = new AboutTools({
    settings: () => ({ ...DEFAULT_SETTINGS, browserUse: false, queenMemory: ['my private note'] }),
    worktree: (id) => (id === 'w' ? { worktree, project } : undefined),
    connections: () => ['Postgres', 'Gmail']
  })

  it("tells an agent where it is, what it can use and where the app's features live", async () => {
    const { text } = await tools.call({ id: 'a', workspaceId: 'w', petName: 'Milo' })
    expect(text).toContain('You are Milo, an agent in worktree "login" of workspace "web", on branch hiveory/login.')
    expect(text).toContain('code host gitlab; issues from linear')
    expect(text).toContain('Built-in browser (browser_* tools; the user watches it): off')
    expect(text).toContain('Postgres, Gmail')
    expect(text).toContain('Settings › Integrations')
    expect(text).not.toContain('my private note')
  })

  it('answers chats and bots outside a worktree too', async () => {
    expect((await tools.call({ id: 'c', workspaceId: 'chat-c', petName: 'Chat' })).text).toContain('outside a Work worktree')
  })

  it('is mentioned to every launched agent, with or without coordination tools', () => {
    const mcp = { url: 'u', token: 't' }
    expect(agentPrompt(mcp)).toContain('hiveory_about')
    expect(agentPrompt(mcp, false)).toContain('hiveory_about')
  })
})
