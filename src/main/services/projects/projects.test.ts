import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { AgentService } from '../agents/agent-service'
import { GitService } from '../git/git-service'
import { WorktreeService } from '../git/worktree-service'
import { StateStore } from '../persistence/state-store'
import { WorkspaceRepository } from '../workspaces/workspace-repository'
import { WorkspaceService } from '../workspaces/workspace-service'
import { ProjectService } from './project-service'
import { isCloneUrl, repoNameOf } from './repository-service'

const log = { info: () => undefined, warn: () => undefined, error: () => undefined }
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim()

const setup = () => {
  const root = mkdtempSync(join(tmpdir(), 'hv-projects-'))
  const repo = join(root, 'demo')
  mkdirSync(repo)
  git(repo, 'init', '-b', 'main')
  git(repo, 'config', 'user.email', 'e2e@example.test')
  git(repo, 'config', 'user.name', 'e2e')
  writeFileSync(join(repo, 'README.md'), '# demo\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-m', 'init')
  const store = new StateStore(join(root, 'state.json'), log)
  const agents = { stopProject: vi.fn(), resumeAll: vi.fn(), createInstances: vi.fn(), countInWorkspace: () => 0 } as unknown as AgentService
  const gitService = new GitService()
  const repoStore = new WorkspaceRepository(store)
  const workspaces = new WorkspaceService(repoStore, gitService, new WorktreeService(gitService), agents, join(root, 'Workspaces'), () => undefined)
  const projects = new ProjectService(store, gitService, agents, () => undefined)
  return { repo, store, agents, workspaces, projects }
}

describe('removing and adding a project again', () => {
  it('archives the whole project and restores it as it was', async () => {
    const { repo, store, agents, workspaces, projects } = setup()
    const project = await projects.open(repo)
    const ws = await workspaces.create({ projectId: project.id, kind: 'isolated', name: 'Amber', cliSelections: [], autoApprove: false })
    store.update((s) => {
      s.instances.push({ id: 'a1', projectId: project.id, workspaceId: ws.id, cliId: 'claude', petName: 'Milo', conversationId: 'c1', hasConversation: true, autoApprove: false, createdAt: '' })
    })

    projects.remove(project.id)
    expect(agents.stopProject).toHaveBeenCalledWith(project.id)
    expect(store.state.projects).toHaveLength(0)
    expect(store.state.workspaces).toHaveLength(0)
    expect(store.state.archive.map((a) => [a.project.id, a.workspaces.length, a.instances.length])).toEqual([[project.id, 1, 1]])
    // The workspace folder is archived, not orphaned.
    expect(workspaces.foundWorktrees()).toEqual([])

    const again = await projects.open(repo)
    expect(again.id).toBe(project.id)
    expect(store.state.workspaces.map((w) => w.name)).toEqual(['Amber'])
    expect(store.state.instances.map((i) => i.petName)).toEqual(['Milo'])
    expect(store.state.archive).toHaveLength(0)
    expect(agents.resumeAll).toHaveBeenCalledWith(project.id)
  })

  it('finds workspace folders a forgotten project left behind, and adopts them', async () => {
    const { repo, store, workspaces, projects } = setup()
    const first = await projects.open(repo)
    await workspaces.create({ projectId: first.id, kind: 'isolated', name: 'Quiet Marsh', cliSelections: [], autoApprove: false })
    // What older versions did on remove: everything forgotten, the worktree left on disk.
    store.update((s) => {
      s.projects = []
      s.workspaces = []
    })
    const found = workspaces.foundWorktrees()
    expect(found.map((f) => [f.name, f.workspaces])).toEqual([['demo', ['quiet-marsh']]])

    const second = await projects.open(repo)
    expect(second.id).not.toBe(first.id)
    expect(await workspaces.adoptWorktrees(second.id)).toBe(1)
    expect(store.state.workspaces.map((w) => [w.name, w.kind, w.git?.branch])).toEqual([['quiet-marsh', 'isolated', 'hiveory/quiet-marsh']])
    // Adopted once only.
    expect(await workspaces.adoptWorktrees(second.id)).toBe(0)
    expect(workspaces.foundWorktrees()).toEqual([])
  })
})

describe('repository addresses', () => {
  it('accepts https and SSH clone addresses only', () => {
    expect(isCloneUrl('https://github.com/acme/web.git')).toBe(true)
    expect(isCloneUrl('git@github.com:acme/web.git')).toBe(true)
    expect(isCloneUrl('ssh://git@host/acme/web')).toBe(true)
    expect(isCloneUrl('--upload-pack=evil')).toBe(false)
    expect(isCloneUrl('ext::sh -c touch% /tmp/x')).toBe(false)
    expect(isCloneUrl('file:///etc')).toBe(false)
    expect(repoNameOf('https://github.com/acme/web-app.git')).toBe('web-app')
    expect(repoNameOf('git@github.com:acme/api.git')).toBe('api')
  })
})
