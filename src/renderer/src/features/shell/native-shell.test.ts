import { describe, expect, it } from 'vitest'
import type { AgentUpdate } from '@shared/domain'
import { scriptCommandProblem, SCRIPT_NAME } from '@shared/domain'
import { scriptProblem } from '../project/scripts'
import { alertText, alertWanted } from './alerts'

const update = (kind: AgentUpdate['kind'], extra: Partial<AgentUpdate> = {}): AgentUpdate => ({
  kind,
  instanceId: 'a1',
  petName: 'Juno',
  cliName: 'Claude Code',
  projectId: 'p1',
  workspaceId: 'w1',
  workspaceName: 'login-fix',
  ...extra
})

describe('desktop alerts (ADR 0061)', () => {
  it('follows the setting', () => {
    expect(['finished', 'waiting', 'stopped'].map((k) => alertWanted('all', k as AgentUpdate['kind']))).toEqual([true, true, true])
    expect(['finished', 'waiting', 'stopped'].map((k) => alertWanted('needs-you', k as AgentUpdate['kind']))).toEqual([false, true, false])
    expect(['finished', 'waiting', 'stopped'].map((k) => alertWanted('off', k as AgentUpdate['kind']))).toEqual([false, false, false])
  })

  it('says who and where, with the reason and the last words', () => {
    expect(alertText(update('waiting', { reason: 'permission' }))).toEqual({ title: 'Juno needs you', body: 'Claude Code · login-fix — permission' })
    expect(alertText(update('finished', { workedSeconds: 185, excerpt: 'All   tests\npass' }))).toEqual({ title: 'Juno finished', body: 'Claude Code · login-fix · worked 3 min\nAll tests pass' })
    expect(alertText(update('finished', { workedSeconds: 20 })).body).toBe('Claude Code · login-fix')
    expect(alertText(update('stopped', { reason: 'exit 1' }))).toEqual({ title: 'Juno stopped', body: 'Claude Code · login-fix — exit 1' })
  })

  it('keeps the body within what the notification channel takes', () => {
    expect(alertText(update('waiting', { reason: 'x'.repeat(500), excerpt: 'y'.repeat(500) })).body.length).toBeLessThanOrEqual(300)
  })
})

describe('Workspace scripts (ADR 0061)', () => {
  it('takes readable names and one-line commands', () => {
    expect(['dev', 'test:unit', 'Build all', 'e2e.ci-1'].every((n) => SCRIPT_NAME.test(n))).toBe(true)
    expect(['', ' dev', '-x', 'a'.repeat(41), 'rm;x', 'dev\n'].some((n) => SCRIPT_NAME.test(n))).toBe(false)
    expect(scriptCommandProblem('pnpm dev && echo ok')).toBeNull()
    expect(scriptCommandProblem('  ')).toMatch(/Enter/)
    expect(scriptCommandProblem('a\nb')).toMatch(/one line/)
    expect(scriptCommandProblem('a\u0007b')).toMatch(/one line/)
    expect(scriptCommandProblem('x'.repeat(2001))).toMatch(/too long/)
  })

  it('refuses a second script of the same name and more than twenty', () => {
    const list = [{ name: 'dev', command: 'pnpm dev' }]
    expect(scriptProblem('Dev', 'npm run dev', list)).toMatch(/already/)
    expect(scriptProblem('test', 'pnpm test', list)).toBeNull()
    const full = Array.from({ length: 20 }, (_, i) => ({ name: `s${i}`, command: 'x' }))
    expect(scriptProblem('one-more', 'x', full)).toMatch(/up to 20/)
  })
})
