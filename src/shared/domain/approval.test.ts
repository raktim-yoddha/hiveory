import { describe, expect, it } from 'vitest'
import { approvalDetail, approvalGate, approvalTool, toolRisk } from './approval'

describe('tool risk', () => {
  it('reads, changes or sends, by the first verb-like word', () => {
    expect(toolRisk('composio_GMAIL_FETCH_EMAILS')).toBe('read')
    expect(toolRisk('composio_GMAIL_LIST_MESSAGES')).toBe('read')
    expect(toolRisk('composio_GITHUB_GET_POST')).toBe('read')
    expect(toolRisk('composio_GMAIL_SEND_EMAIL')).toBe('send')
    expect(toolRisk('composio_SLACK_CHAT_POST_MESSAGE')).toBe('send')
    expect(toolRisk('composio_GMAIL_REPLY_TO_THREAD')).toBe('send')
    expect(toolRisk('composio_GITHUB_CREATE_AN_ISSUE_COMMENT')).toBe('send')
    expect(toolRisk('composio_GMAIL_CREATE_EMAIL_DRAFT')).toBe('change')
    expect(toolRisk('files_write_file')).toBe('change')
    expect(toolRisk('files_readFile')).toBe('read')
  })

  it('treats code runners as sending, and a meta tool as its riskiest inner action', () => {
    expect(toolRisk('composio_COMPOSIO_REMOTE_BASH_TOOL')).toBe('send')
    expect(toolRisk('composio_COMPOSIO_REMOTE_WORKBENCH')).toBe('send')
    expect(toolRisk('composio_COMPOSIO_SEARCH_TOOLS')).toBe('read')
    expect(toolRisk('composio_COMPOSIO_MULTI_EXECUTE_TOOL', { tools: [{ tool_slug: 'GMAIL_FETCH_EMAILS' }] })).toBe('read')
    expect(toolRisk('composio_COMPOSIO_MULTI_EXECUTE_TOOL', { tools: [{ tool_slug: 'GMAIL_FETCH_EMAILS' }, { tool_slug: 'SLACK_SEND_MESSAGE' }] })).toBe('send')
    // Without inner actions, "execute" could be anything.
    expect(toolRisk('composio_COMPOSIO_MULTI_EXECUTE_TOOL', {})).toBe('send')
  })

  it('names the inner actions and shows their arguments, cut short', () => {
    const args = { tools: [{ tool_slug: 'GMAIL_SEND_EMAIL', arguments: { to: 'alex@example.com' } }] }
    expect(approvalTool('composio_COMPOSIO_MULTI_EXECUTE_TOOL', args)).toBe('GMAIL_SEND_EMAIL')
    expect(approvalTool('files_write_file', { path: 'a' })).toBe('files_write_file')
    expect(approvalDetail(args)).toContain('alex@example.com')
    expect(approvalDetail({ text: 'x'.repeat(5000) }).length).toBeLessThan(1600)
  })
})

describe('approval gate', () => {
  it('lets reads through, refuses changes in read-only runs and asks by level', () => {
    expect(approvalGate('changes', 'read', true)).toBe('allow')
    expect(approvalGate('never', 'send', true)).toBe('refuse')
    expect(approvalGate('never', 'send', false)).toBe('allow')
    expect(approvalGate('sends', 'change', false)).toBe('allow')
    expect(approvalGate('sends', 'send', false)).toBe('ask')
    expect(approvalGate('changes', 'change', false)).toBe('ask')
  })
})
