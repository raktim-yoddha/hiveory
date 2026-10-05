import { describe, expect, it } from 'vitest'
import type { CliInstance, CliRuntimeDetails } from '@shared/domain'
import { lastWords, type QueenUpdate } from '@shared/queen/updates'
import { QueenWatcher } from './queen-watcher'

const agent = (id: string, cliId = 'claude'): CliInstance => ({ id, cliId, petName: id === 'a1' ? 'Bruno' : 'Otis', projectId: 'p1', workspaceId: 'w1' }) as CliInstance
const rt = (status: CliRuntimeDetails['status'], running = true, extra: Partial<CliRuntimeDetails> = {}): CliRuntimeDetails => ({ status, running, ...extra })

const setup = () => {
  let now = 0
  const updates: QueenUpdate[] = []
  const watcher = new QueenWatcher({
    agent: (id) => agent(id, id === 'a2' ? 'powershell' : 'claude'),
    isShell: (cliId) => cliId === 'powershell',
    cliName: () => 'Claude Code',
    workspaceName: () => 'Main',
    excerpt: () => 'All 42 tests pass.',
    emit: (u) => updates.push(u),
    now: () => now
  })
  return { watcher, updates, tick: (ms: number) => (now += ms) }
}

describe('Queen Bee live updates', () => {
  it('tells when an agent finishes real work, and when it needs you', () => {
    const { watcher, updates, tick } = setup()
    watcher.onRuntime('a1', rt('idle'))
    watcher.onRuntime('a1', rt('working'))
    tick(65_000)
    watcher.onRuntime('a1', rt('idle'))
    watcher.onRuntime('a1', rt('waiting-for-you', true, { waitingReason: 'permission' }))
    expect(updates).toEqual([
      { kind: 'finished', instanceId: 'a1', petName: 'Bruno', cliName: 'Claude Code', projectId: 'p1', workspaceId: 'w1', workspaceName: 'Main', workedSeconds: 65, excerpt: 'All 42 tests pass.' },
      { kind: 'waiting', instanceId: 'a1', petName: 'Bruno', cliName: 'Claude Code', projectId: 'p1', workspaceId: 'w1', workspaceName: 'Main', reason: 'permission', excerpt: 'All 42 tests pass.' }
    ])
  })

  it('stays quiet for blips, the first status it sees, repeats and plain shells', () => {
    const { watcher, updates, tick } = setup()
    // First sight (app launch, a restored agent already asking something): only recorded.
    watcher.onRuntime('a1', rt('waiting-for-you'))
    watcher.onRuntime('a1', rt('waiting-for-you'))
    watcher.onRuntime('a1', rt('idle'))
    expect(updates).toHaveLength(0)
    watcher.onRuntime('a1', rt('working'))
    tick(1000)
    watcher.onRuntime('a1', rt('idle'))
    watcher.onRuntime('a2', rt('working'))
    tick(10_000)
    watcher.onRuntime('a2', rt('idle'))
    expect(updates).toHaveLength(0)
  })

  it('reports a crash, but not a clean exit', () => {
    const { watcher, updates } = setup()
    watcher.onRuntime('a1', rt('idle'))
    watcher.onRuntime('a1', rt('idle', false, { error: 'exit code 1' }))
    watcher.onRuntime('a1', rt('idle'))
    watcher.onRuntime('a1', rt('idle', false))
    expect(updates.map((u) => u.kind)).toEqual(['stopped'])
  })
})

describe('an agent’s last words on screen', () => {
  it('skips the TUI frame, hints and the empty input box', () => {
    const screen = [
      '⏺ I updated the login form and ran the suite.',
      '⏺ All 42 tests pass. Ready for review.',
      '',
      '╭──────────────────────────────────────────╮',
      '│ >                                        │',
      '╰──────────────────────────────────────────╯',
      '  ? for shortcuts                ⏵⏵ accept edits on (shift+tab to cycle)'
    ].join('\n')
    expect(lastWords(screen)).toBe('I updated the login form and ran the suite. All 42 tests pass. Ready for review.')
    expect(lastWords('╭───╮\n│ > │\n╰───╯')).toBeUndefined()
  })
})

describe('an agent’s last words in a narrow pane', () => {
  it('drops hint scraps that wrapped onto their own lines', () => {
    expect(lastWords('Done.\nEnter to confirm · Esc to\ncancel')).toBe('Done.')
    expect(lastWords('Security guide\n> No, exit\nEsc to\ncancel')).toBeUndefined()
  })
})
