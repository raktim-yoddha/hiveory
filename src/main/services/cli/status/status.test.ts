import { describe, expect, it } from 'vitest'
import { CLI_STATUSES } from '@shared/domain'
import { claudeAdapter, mapClaudeHookEvent } from '../adapters/claude'
import { codexAdapter } from '../adapters/codex'
import { HeuristicDetector, stripAnsi } from './heuristics'
import { NOT_RUNNING, reduceStatus, type StatusEvent } from './status-machine'

const run = (...events: StatusEvent[]) => events.reduce(reduceStatus, NOT_RUNNING)

describe('status normalization', () => {
  it('follows idle → working → waiting → working → idle', () => {
    expect(run({ type: 'started' }).status).toBe('idle')
    expect(run({ type: 'started' }, { type: 'working' }).status).toBe('working')
    const waiting = run({ type: 'started' }, { type: 'working' }, { type: 'needs-user', reason: 'permission' })
    expect(waiting).toMatchObject({ status: 'waiting-for-you', waitingReason: 'permission', activity: 'Needs your permission' })
    expect(reduceStatus(waiting, { type: 'working' }).waitingReason).toBeUndefined()
    expect(run({ type: 'started' }, { type: 'working' }, { type: 'turn-complete' }).status).toBe('idle')
  })

  it('allows idle → waiting directly', () => {
    expect(run({ type: 'started' }, { type: 'needs-user', reason: 'input' }).status).toBe('waiting-for-you')
  })

  it('represents errors without a fourth status', () => {
    const failed = run({ type: 'failed', error: 'spawn ENOENT' })
    expect(failed).toMatchObject({ status: 'idle', running: false, error: 'spawn ENOENT' })
    const crashed = run({ type: 'started' }, { type: 'working' }, { type: 'exited', code: 1 })
    expect(crashed).toMatchObject({ status: 'idle', running: false })
    expect(crashed.error).toBeTruthy()
    for (const d of [failed, crashed]) expect(CLI_STATUSES).toContain(d.status)
  })

  it('ignores activity events when no process is attached', () => {
    expect(run({ type: 'working' })).toBe(NOT_RUNNING)
  })
})

describe('claude hook mapping', () => {
  it('maps lifecycle hooks', () => {
    expect(mapClaudeHookEvent('UserPromptSubmit', {})).toMatchObject({ type: 'working' })
    expect(mapClaudeHookEvent('PreToolUse', { tool_name: 'Bash' })).toMatchObject({ type: 'working', activity: 'Using Bash' })
    expect(mapClaudeHookEvent('Stop', {})).toEqual({ type: 'turn-complete' })
  })

  it('maps permission and questions to waiting reasons', () => {
    expect(mapClaudeHookEvent('PermissionRequest', { tool_name: 'Edit' })).toMatchObject({ reason: 'permission' })
    // PermissionRequest reports the prompt; a late Notification must not flag a working agent.
    expect(mapClaudeHookEvent('Notification', { notification_type: 'permission_prompt' })).toBeNull()
    expect(mapClaudeHookEvent('Notification', { notification_type: 'elicitation_dialog' })).toMatchObject({ reason: 'input' })
    expect(mapClaudeHookEvent('PreToolUse', { tool_name: 'AskUserQuestion' })).toMatchObject({ reason: 'input' })
    expect(mapClaudeHookEvent('Notification', { notification_type: 'idle_prompt' })).toBeNull()
  })

  it('tolerates garbage payloads', () => {
    expect(mapClaudeHookEvent('PreToolUse', null)).toMatchObject({ type: 'working' })
    expect(mapClaudeHookEvent('Unknown', 42)).toBeNull()
  })
})

describe('codex notify mapping', () => {
  it('maps turn completion only', () => {
    expect(codexAdapter.mapHookEvent?.('notify', { type: 'agent-turn-complete' })).toEqual({ type: 'turn-complete' })
    expect(codexAdapter.mapHookEvent?.('notify', { type: 'other' })).toBeNull()
  })
})

describe('heuristic detector', () => {
  const config = {
    waitingPatterns: [{ pattern: /Allow command\?/, reason: 'permission' as const }],
    workingOnSubmit: true,
    idleAfterSilenceMs: 1000,
    idlePatterns: [/Interrupted/]
  }

  it('detects working on submit and idle after silence', () => {
    const d = new HeuristicDetector(config)
    expect(d.onInput('abc', 0)).toBeNull()
    expect(d.onInput('\r', 0)).toEqual({ type: 'working' })
    d.onOutput('thinking…', 500)
    expect(d.tick(1000)).toBeNull()
    expect(d.tick(1600)).toEqual({ type: 'turn-complete' })
    expect(d.tick(5000)).toBeNull()
  })

  it('detects waiting prompts through ANSI noise and clears on answer', () => {
    const d = new HeuristicDetector(config)
    d.onInput('\r', 0)
    expect(d.onOutput('\u001b[1mAllow\u001b[0m command?', 10)).toEqual({ type: 'needs-user', reason: 'permission' })
    expect(d.tick(10_000)).toBeNull()
    expect(d.onInput('\r', 20)).toEqual({ type: 'working' })
    expect(d.onOutput('running', 30)).toBeNull()
  })

  it('counts silence from when hooks start a turn, not from the last output before it', () => {
    const d = new HeuristicDetector({ ...config, workingOnSubmit: false, idleAfterSilenceMs: 8000 })
    expect(d.onOutput('prompt ready', 0)).toBeNull()
    d.sync('working', 12_000)
    expect(d.tick(13_000)).toBeNull()
    expect(d.tick(20_100)).toEqual({ type: 'turn-complete' })
  })

  it('treats interrupts as turn end', () => {
    const d = new HeuristicDetector({ ...config, workingOnSubmit: false })
    d.sync('working')
    expect(d.onOutput('⎿ Interrupted', 0)).toEqual({ type: 'turn-complete' })
  })

  it('ends waiting when the prompt is answered with a choice key, and ignores its last frames', () => {
    const d = new HeuristicDetector(config)
    d.onInput('\r', 0)
    expect(d.onOutput('Allow command?', 10)).toMatchObject({ type: 'needs-user' })
    expect(d.onInput('1', 20)).toEqual({ type: 'working' })
    // The prompt drawn once more while the CLI removes it is not a new prompt.
    expect(d.onOutput('Allow command?', 30)).toBeNull()
    expect(d.tick(100)).toBeNull()
    // A real second prompt later is.
    expect(d.onOutput('Allow command?', 2000)).toMatchObject({ type: 'needs-user', reason: 'permission' })
  })

  it('typing into a question does not answer it until Enter', () => {
    const d = new HeuristicDetector(config)
    d.sync('waiting', 0, 'input')
    expect(d.onInput('y', 10)).toBeNull()
    expect(d.onInput('\r', 20)).toEqual({ type: 'working' })
  })

  it('confirms prompts against the screen and ends waiting when the prompt leaves it', () => {
    let screen = 'working…'
    const d = new HeuristicDetector(config, () => screen)
    d.onInput('\r', 0)
    // A prompt that flashed by and is not on screen is ignored.
    expect(d.onOutput('Allow command?', 10)).toBeNull()
    expect(d.tick(500)).toBeNull()
    // One that stays on screen counts.
    screen = '│ Allow\n│ command?'
    expect(d.onOutput('Allow command?', 600)).toBeNull()
    expect(d.tick(700)).toEqual({ type: 'needs-user', reason: 'permission' })
    expect(d.tick(1700)).toBeNull()
    // Answered some other way (phone, Queen): it leaves the screen and the agent is working again.
    screen = 'running tests'
    expect(d.tick(2700)).toEqual({ type: 'working' })
  })

  it('leaves hook-reported waiting to the hooks and the user', () => {
    const d = new HeuristicDetector(config, () => 'nothing matching here')
    d.sync('waiting', 0, 'permission')
    expect(d.tick(5000)).toBeNull()
    expect(d.onInput('\u001b', 5100)).toEqual({ type: 'working' })
  })

  it('strips ANSI sequences', () => {
    expect(stripAnsi('\u001b[31mred\u001b[0m \u001b]0;title\u0007ok')).toBe('red ok')
  })

  it('restores ConPTY cursor-forward spaces and positioned lines', () => {
    const conpty = '\u001b[13;2HIs\u001b[1Cthis\u001b[1Cone\u001b[1Cyou\u001b[1Ctrust?\u001b[14;2Hnext'
    expect(stripAnsi(conpty)).toBe('\nIs this one you trust?\nnext')
    expect(claudeAdapter.heuristics(true)?.waitingPatterns.some(({ pattern }) => pattern.test(stripAnsi(conpty)))).toBe(true)
  })
})
