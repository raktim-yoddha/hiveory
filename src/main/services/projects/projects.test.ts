import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { mainWorkspaceId } from '@shared/domain'
import type { AgentService } from '../agents/agent-service'
import { GitService } from '../git/git-service'
import { WorktreeService } from '../git/worktree-service'
import { StateStore } from '../persistence/state-store'
import { WorkspaceRepository } from '../workspaces/workspace-repository'
import { WorkspaceService } from '../workspaces/workspace-service'
import { ProjectService } from './project-service'
import { localKitSource } from '../hosts/host-kit'
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
  const agents = { stopProject: vi.fn(), resumeAll: vi.fn(), createInstances: vi.fn(), forgetWorkspace: vi.fn(), countInWorkspace: () => 0 } as unknown as AgentService
  const gitService = new GitService()
  const repoStore = new WorkspaceRepository(store)
  const kits = localKitSource(gitService, new WorktreeService(gitService), join(root, 'Workspaces'))
  const workspaces = new WorkspaceService(repoStore, kits, agents, join(root, 'Workspaces'), () => undefined)
  const projects = new ProjectService(store, kits, agents, () => undefined)
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

describe('one Main workspace per checkout (ADR 0021)', () => {
  const main = (projectId: string) => ({ projectId, kind: 'main' as const, name: 'Main', cliSelections: [], autoApprove: false })

  it('refuses a second Main workspace on the same checkout from a subfolder project', async () => {
    const { repo, workspaces, projects } = setup()
    mkdirSync(join(repo, 'web'))
    const root = await projects.open(repo)
    const sub = await projects.open(join(repo, 'web'))
    expect(sub.id).not.toBe(root.id)
    await workspaces.create(main(root.id))
    await expect(workspaces.create(main(sub.id))).rejects.toMatchObject({ error: { code: 'INVALID_INPUT' } })
    // It can live in the other project instead, once removed from the first.
    await workspaces.delete(mainWorkspaceId(root.id), false)
    await expect(workspaces.create(main(sub.id))).resolves.toMatchObject({ kind: 'main' })
  })

  it("refuses a Main workspace on a folder that is another project's isolated workspace", async () => {
    const { workspaces, projects, repo } = setup()
    const root = await projects.open(repo)
    const ws = await workspaces.create({ projectId: root.id, kind: 'isolated', name: 'Amber', cliSelections: [], autoApprove: false })
    const linked = await projects.open(ws.path)
    await expect(workspaces.create(main(linked.id))).rejects.toMatchObject({ error: { code: 'INVALID_INPUT' } })
  })

  it('will not restore a project whose Main workspace another project now holds', async () => {
    const { repo, workspaces, projects } = setup()
    mkdirSync(join(repo, 'web'))
    const sub = await projects.open(join(repo, 'web'))
    await workspaces.create(main(sub.id))
    projects.remove(sub.id)
    const root = await projects.open(repo)
    await workspaces.create(main(root.id))
    await expect(projects.open(join(repo, 'web'))).rejects.toMatchObject({ error: { code: 'INVALID_INPUT' } })
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

describe('project activity (ADR 0024)', () => {
  it('moves only on real work, at most every 30 seconds; looking at a project does not', async () => {
    const { repo, store, projects } = setup()
    const project = await projects.open(repo)
    expect(project.lastActiveAt).toBeUndefined()
    projects.touch(project.id)
    expect(store.state.projects[0]!.lastActiveAt).toBeUndefined()
    projects.markActive(project.id)
    const first = store.state.projects[0]!.lastActiveAt
    expect(first).toBeTruthy()
    // Already the most recent: a quick second turn changes nothing.
    projects.markActive(project.id)
    expect(store.state.projects[0]!.lastActiveAt).toBe(first)
    // Another project worked on since: the next turn here moves it back up straight away.
    vi.useFakeTimers({ now: Date.parse(first!) + 5000 })
    store.update((s) => {
      s.projects.push({ ...s.projects[0]!, id: 'other', name: 'other', path: '/other', lastActiveAt: new Date(Date.parse(first!) + 2000).toISOString() })
    })
    projects.markActive(project.id)
    expect(store.state.projects[0]!.lastActiveAt).toBe(new Date(Date.parse(first!) + 5000).toISOString())
    vi.useRealTimers()
    projects.markActive('missing')
    projects.markActive(undefined)
  })
})

describe('Workspace settings (ADR 0037)', () => {
  it('renames, merges and clears settings, and new worktrees follow them', async () => {
    const { repo, projects, workspaces } = setup()
    const project = await projects.open(repo)
    git(repo, 'branch', 'develop')
    projects.update(project.id, { name: '  Shop  ', settings: { agentView: 'chat', branchPrefix: 'feat/', baseRef: 'develop', alerts: false } })
    const updated = projects.update(project.id, { settings: { alerts: null } })
    expect(updated.name).toBe('Shop')
    expect(updated.settings).toEqual({ agentView: 'chat', branchPrefix: 'feat/', baseRef: 'develop' })

    const ws = await workspaces.create({ projectId: project.id, kind: 'isolated', name: 'Amber', cliSelections: [], autoApprove: false })
    expect(ws.git).toMatchObject({ branch: 'feat/amber', baseRef: 'develop' })
    expect(ws.chatUi).toBe(true)

    const cleared = projects.update(project.id, { settings: { agentView: null, branchPrefix: null, baseRef: null } })
    expect(cleared.settings).toBeUndefined()
  })
})
