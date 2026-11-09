import { describe, expect, it } from 'vitest'
import type { PullRequestDetail } from '@shared/domain/github'
import { nextGitStep } from './git-step'

const status = (patch: Partial<{ branch: string; upstream: string; ahead: number; changed: number; untracked: number }> = {}) => ({
  branch: 'feature/login',
  upstream: 'origin/feature/login',
  ahead: 0,
  behind: 0,
  changed: 0,
  untracked: 0,
  ...patch
})
const pr = (state: PullRequestDetail['state']): PullRequestDetail => ({ number: 1, title: 't', branch: 'feature/login', url: 'u', draft: false, updatedAt: '', author: '', state, checks: [] })

describe("the worktree bar's next git step (ADR 0064)", () => {
  it('commits first, whatever else is pending', () => {
    expect(nextGitStep(status({ untracked: 1, ahead: 3 }), pr('open'), false)).toBe('commit')
  })
  it('publishes a new branch, then pushes commits not on the remote', () => {
    expect(nextGitStep(status({ upstream: undefined }), undefined, false)).toBe('publish')
    expect(nextGitStep(status({ ahead: 2 }), null, false)).toBe('push')
  })
  it('opens a pull request when there is none, merges the open one', () => {
    expect(nextGitStep(status(), null, false)).toBe('create-pr')
    expect(nextGitStep(status(), pr('open'), false)).toBe('merge')
    expect(nextGitStep(status(), pr('merged'), false)).toBe('none')
  })
  it('waits while the pull request is unknown, and never suggests one for the Primary', () => {
    expect(nextGitStep(status(), undefined, false)).toBe('none')
    expect(nextGitStep(status(), null, true)).toBe('none')
    expect(nextGitStep(status({ upstream: undefined }), null, true)).toBe('none')
  })
  it('does nothing outside Git', () => {
    expect(nextGitStep(null, undefined, false)).toBe('none')
  })
})
