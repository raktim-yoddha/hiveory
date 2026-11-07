import { describe, expect, it } from 'vitest'
import type { Project, WorkspaceView } from '@shared/domain'
import { lastWorktreeOf, sortProjects, worktreeInitials, worktreeLabel } from './project-list'

const wt = (id: string, kind: 'main' | 'isolated', name: string, branch?: string) =>
  ({ id, kind, name, git: branch ? { branch } : undefined }) as WorkspaceView

describe('worktreeInitials', () => {
  it('takes the first letters of the branch’s first two words', () => {
    expect(worktreeInitials(wt('a', 'isolated', 'x', 'feature/login-page'))).toBe('LP')
    expect(worktreeInitials(wt('a', 'isolated', 'x', 'fix_auth.token'))).toBe('FA')
  })
  it('takes two letters of a one-word branch, else the name', () => {
    expect(worktreeInitials(wt('a', 'main', 'Primary', 'main'))).toBe('MA')
    expect(worktreeInitials(wt('a', 'isolated', 'demo'))).toBe('DE')
    expect(worktreeInitials(wt('a', 'isolated', ''))).toBe('?')
  })
})

describe('worktreeLabel', () => {
  it('names Primary and adds a different branch', () => {
    expect(worktreeLabel(wt('a', 'main', 'whatever', 'main'))).toBe('Primary · main')
    expect(worktreeLabel(wt('a', 'isolated', 'login', 'login'))).toBe('login')
  })
})

describe('lastWorktreeOf', () => {
  const list = [wt('b', 'isolated', 'b'), wt('m', 'main', 'Primary')]
  it('opens the remembered Worktree, else Primary, else the first', () => {
    expect(lastWorktreeOf(list, 'b')?.id).toBe('b')
    expect(lastWorktreeOf(list, 'gone')?.id).toBe('m')
    expect(lastWorktreeOf([wt('x', 'isolated', 'x')])?.id).toBe('x')
    expect(lastWorktreeOf([])).toBeUndefined()
  })
})

describe('sortProjects', () => {
  const p = (name: string, at: string) => ({ name, createdAt: at }) as Project
  it('sorts by name or by last activity', () => {
    const list = [p('b', '2026-01-01'), p('a', '2026-02-01')]
    expect(sortProjects(list, 'name').map((x) => x.name)).toEqual(['a', 'b'])
    expect(sortProjects(list, 'recent').map((x) => x.name)).toEqual(['a', 'b'])
    expect(sortProjects([p('a', '2026-01-01'), p('b', '2026-03-01')], 'recent').map((x) => x.name)).toEqual(['b', 'a'])
  })
})
