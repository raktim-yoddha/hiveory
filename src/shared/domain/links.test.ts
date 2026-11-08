import { describe, expect, it } from 'vitest'
import { linkFromArgv, MAX_LINK_PROMPT, openLink, parseHiveoryLink, promptLink } from './links'

describe('hiveory:// links (ADR 0061)', () => {
  it('opens a Workspace, and one of its worktrees', () => {
    expect(parseHiveoryLink('hiveory://open?p=p1')).toEqual({ kind: 'open', projectId: 'p1' })
    expect(parseHiveoryLink('hiveory://open?p=p1&w=w-2')).toEqual({ kind: 'open', projectId: 'p1', workspaceId: 'w-2' })
    expect(parseHiveoryLink('HIVEORY://OPEN/?p=p1')).toEqual({ kind: 'open', projectId: 'p1' })
    expect(parseHiveoryLink('hiveory:open?p=p1')).toEqual({ kind: 'open', projectId: 'p1' })
  })

  it('starts a chat draft from a prompt, never empty or too long', () => {
    expect(parseHiveoryLink(promptLink('Fix the build\r\nplease', { projectId: 'p1', workspaceId: 'w1' }))).toEqual({ kind: 'new', prompt: 'Fix the build\nplease', projectId: 'p1', workspaceId: 'w1' })
    expect(parseHiveoryLink('hiveory://new?prompt=%20%20')).toBeNull()
    expect(parseHiveoryLink(`hiveory://new?prompt=${'x'.repeat(MAX_LINK_PROMPT + 1)}`)).toBeNull()
    expect(parseHiveoryLink(`hiveory://new?prompt=${'x'.repeat(MAX_LINK_PROMPT)}`)).toMatchObject({ kind: 'new' })
    // promptLink cuts a long prompt so the link stays valid.
    expect(parseHiveoryLink(promptLink('y'.repeat(MAX_LINK_PROMPT + 50)))).toMatchObject({ kind: 'new', prompt: 'y'.repeat(MAX_LINK_PROMPT) })
  })

  it('refuses other schemes, unknown actions, bad ids and garbage', () => {
    for (const bad of [
      'https://open?p=p1',
      'javascript:alert(1)',
      'hiveory://run?cmd=rm',
      'hiveory://open',
      'hiveory://open?p=../etc',
      'hiveory://open?p=a%20b',
      'hiveory://pair?a=host&p=7788&c=CODE1234',
      'not a url',
      ''
    ]) {
      expect(parseHiveoryLink(bad)).toBeNull()
    }
    // A bad worktree id is dropped; the Workspace still opens.
    expect(parseHiveoryLink('hiveory://open?p=p1&w=<x>')).toEqual({ kind: 'open', projectId: 'p1' })
  })

  it('finds the link among process arguments', () => {
    expect(linkFromArgv(['C:/Hiveory.exe', '--flag', openLink('p1', 'w1')])).toEqual({ kind: 'open', projectId: 'p1', workspaceId: 'w1' })
    expect(linkFromArgv(['Hiveory', 'hiveory://pair?a=x', 'hiveory://open?p=p2'])).toEqual({ kind: 'open', projectId: 'p2' })
    expect(linkFromArgv(['Hiveory', '--serve'])).toBeNull()
  })
})
