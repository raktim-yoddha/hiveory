import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isWithin, SessionHistoryService } from './session-history'

const log = { info: () => undefined, warn: () => undefined, error: () => undefined } as never
const lines = (...records: unknown[]): string => records.map((r) => JSON.stringify(r)).join('\n') + '\n'

describe('agent session history', () => {
  const home = mkdtempSync(join(tmpdir(), 'hv-sessions-'))
  const project = join(home, 'code', 'demo')
  const other = join(home, 'code', 'other')

  // Claude Code: one JSONL per session under ~/.claude/projects/<folder>/.
  mkdirSync(join(home, '.claude', 'projects', 'demo'), { recursive: true })
  writeFileSync(
    join(home, '.claude', 'projects', 'demo', '11111111-2222-3333-4444-555555555555.jsonl'),
    lines(
      { type: 'user', cwd: project, timestamp: '2026-10-01T10:00:00Z', message: { role: 'user', content: '<command-name>/clear</command-name>' } },
      { type: 'user', cwd: project, timestamp: '2026-10-01T10:00:05Z', message: { role: 'user', content: 'Fix the login bug' } },
      { type: 'assistant', cwd: project, timestamp: '2026-10-01T10:01:00Z', message: { role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'Fixed it.' }] } },
      { type: 'user', cwd: project, timestamp: '2026-10-01T10:01:05Z', message: { role: 'user', content: [{ type: 'tool_result', content: 'File written' }] } },
      { type: 'custom-title', customTitle: 'Login bug', sessionId: '11111111-2222-3333-4444-555555555555' }
    )
  )
  // Codex: rollout files under ~/.codex/sessions/YYYY/MM/DD, titles in session_index.jsonl.
  const day = join(home, '.codex', 'sessions', '2026', '10', '02')
  mkdirSync(day, { recursive: true })
  writeFileSync(
    join(day, 'rollout-2026-10-02T09-00-00-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl'),
    lines(
      { timestamp: '2026-10-02T09:00:00Z', type: 'session_meta', payload: { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', cwd: other, timestamp: '2026-10-02T09:00:00Z' } },
      { timestamp: '2026-10-02T09:00:01Z', type: 'turn_context', payload: { model: 'gpt-5.6' } },
      { timestamp: '2026-10-02T09:00:02Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>…' }] } },
      { timestamp: '2026-10-02T09:00:03Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Add dark mode' }] } },
      { timestamp: '2026-10-02T09:05:00Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done: dark mode added.' }] } }
    )
  )

  it('reads Claude Code and Codex history, newest first, filtered by folder', async () => {
    const history = new SessionHistoryService(log, home)
    const all = await history.list()
    expect(all.map((s) => s.cliId)).toEqual(['codex', 'claude'])
    expect(all[1]).toMatchObject({ id: '11111111-2222-3333-4444-555555555555', title: 'Login bug', model: 'claude-opus-5-5', cwd: project, preview: { from: 'agent', text: 'Fixed it.' } })
    expect(all[0]).toMatchObject({ title: 'Add dark mode', model: 'gpt-5.6', preview: { from: 'agent', text: 'Done: dark mode added.' } })
    expect((await history.list([project])).map((s) => s.cliId)).toEqual(['claude'])
    expect(await history.list([join(home, 'elsewhere')])).toEqual([])
  })

  it('matches folders and their subfolders only', () => {
    expect(isWithin(join(project, 'src'), project)).toBe(true)
    expect(isWithin(`${project}-copy`, project)).toBe(false)
  })
})
