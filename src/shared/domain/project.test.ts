import { describe, expect, it } from 'vitest'
import { parentRepository, usedRepository, workspaceColor, WORKSPACE_COLORS } from './project'

describe('Workspace colors (ADR 0038)', () => {
  it('keeps a chosen color and otherwise picks a stable one from the id', () => {
    expect(workspaceColor({ id: 'p1', settings: { color: 'red' } })).toBe('red')
    expect(workspaceColor({ id: 'p1' })).toBe(workspaceColor({ id: 'p1' }))
    expect(WORKSPACE_COLORS).toContain(workspaceColor({ id: 'another' }))
  })
})

describe('a repository in a parent folder (ADR 0071)', () => {
  const app = String.raw`C:\code\app`

  it('is the Workspace own only at its folder, however the path is spelled', () => {
    expect(parentRepository({ path: app, repositoryRoot: 'c:/code/app/' })).toBeUndefined()
    expect(usedRepository({ path: app, repositoryRoot: 'c:/code/app/' })).toBe('c:/code/app/')
    expect(parentRepository({ path: '/home/me/app', repositoryRoot: '/home/me/app' })).toBeUndefined()
  })

  it('is left unused in a parent folder until chosen', () => {
    expect(parentRepository({ path: app, repositoryRoot: 'C:/code' })).toBe('C:/code')
    expect(usedRepository({ path: app, repositoryRoot: 'C:/code' })).toBeUndefined()
    expect(usedRepository({ path: '/home/me/app', repositoryRoot: '/home/me' })).toBeUndefined()
    // Case matters on Linux and macOS paths.
    expect(parentRepository({ path: '/home/me/App', repositoryRoot: '/home/me/app' })).toBe('/home/me/app')
    const chosen = { path: app, repositoryRoot: 'C:/code', settings: { useParentRepository: true } }
    expect(parentRepository(chosen)).toBeUndefined()
    expect(usedRepository(chosen)).toBe('C:/code')
    expect(usedRepository({ path: '/x' })).toBeUndefined()
  })
})
