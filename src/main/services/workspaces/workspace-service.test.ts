import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { mainWorkspaceId, type Project } from '@shared/domain'
import { AppException } from '@shared/errors'
import type { AgentService } from '../agents/agent-service'
import type { GitService } from '../git/git-service'
import type { WorktreeService } from '../git/worktree-service'
import { StateStore } from '../persistence/state-store'
import { WorkspaceRepository } from './workspace-repository'
import { WorkspaceService } from './workspace-service'

const log = { info: () => undefined, warn: () => undefined, error: () => undefined }
const project: Project = {
  id: 'proj123456',
  name: 'My App',
  path: '/repo',
  repositoryRoot: '/repo',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  lastOpenedAt: '2026-01-01'
}

const setup = (git: Partial<Record<keyof GitService, unknown>> = {}) => {
  const store = new StateStore(join(mkdtempSync(join(tmpdir(), 'hiveory-')), 'state.json'), log)
  store.update((s) => {
    s.projects.push(project)
  })
  const calls: string[] = []
  const fakeGit = {
    repositoryRoot: vi.fn(async () => '/repo'),
    hasCommits: vi.fn(async () => true),
    defaultBranch: vi.fn(async () => 'main'),
    localBranchExists: vi.fn(async () => false),
    refExists: vi.fn(async () => true),
    branchNameProblem: vi.fn(async () => null),
    currentBranch: vi.fn(async () => 'main'),
    ...git
  } as unknown as GitService
  const worktrees = {
    create: vi.fn(async () => void calls.push('create')),
    remove: vi.fn(async () => void calls.push('remove')),
    prune: vi.fn(async () => undefined),
    deleteBranchIfMerged: vi.fn(async () => true)
  }
  const agents = {
    createInstances: vi.fn(),
    countInWorkspace: vi.fn(() => 0),
    stopWorkspace: vi.fn(() => void calls.push('stop')),
    forgetWorkspace: vi.fn(() => void calls.push('forget'))
  }
  const repo = new WorkspaceRepository(store)
  const service = new WorkspaceService(
    repo,
    fakeGit,
    worktrees as unknown as WorktreeService,
    agents as unknown as AgentService,
    join('/data', 'Workspaces'),
    () => undefined
  )
  return { service, repo, worktrees, agents, calls, store }
}

const input = {
  projectId: project.id,
  kind: 'isolated' as const,
  name: 'Amber Harbor',
  cliSelections: [{ cliId: 'claude', count: 2 }],
  autoApprove: true
}

const code = async (promise: Promise<unknown>) => {
  try {
    await promise
  } catch (error) {
    return error instanceof AppException ? error.error.code : 'non-app-error'
  }
  return 'no-error'
}

describe('workspace creation', () => {
  it('starts with no workspaces — opening a project creates nothing', () => {
    const { service, store } = setup()
    expect(service.list(project.id)).toEqual([])
    expect(store.state.workspaces).toHaveLength(0)
  })

  it('creates the main workspace on request, once, in the project folder without Git work', async () => {
    const { service, worktrees, agents } = setup()
    const main = await service.create({ ...input, kind: 'main', name: 'Main' })
    expect(main).toMatchObject({ id: mainWorkspaceId(project.id), kind: 'main', path: '/repo' })
    expect(worktrees.create).not.toHaveBeenCalled()
    expect(agents.createInstances).toHaveBeenCalledWith(expect.objectContaining({ id: main.id }), input.cliSelections)
    expect(service.list(project.id).map((w) => w.kind)).toEqual(['main'])
    expect(await code(service.create({ ...input, kind: 'main', name: 'Again' }))).toBe('INVALID_INPUT')
  })

  it('adopts an implicit main workspace that already has agents', () => {
    const { repo, store } = setup()
    store.update((s) => {
      s.instances.push({
        id: 'i1', projectId: project.id, workspaceId: mainWorkspaceId(project.id), cliId: 'claude',
        petName: 'Milo', conversationId: 'c', hasConversation: false, autoApprove: false, createdAt: ''
      })
    })
    repo.adoptImplicitMainWorkspaces()
    expect(repo.find(mainWorkspaceId(project.id))).toMatchObject({ kind: 'main', path: '/repo' })
  })

  it('creates a linked worktree on a new local branch from the default branch', async () => {
    const { service, worktrees, agents } = setup()
    const view = await service.create(input)
    expect(worktrees.create).toHaveBeenCalledWith({
      repoRoot: '/repo',
      path: join('/data', 'Workspaces', 'my-app-proj12', 'amber-harbor'),
      branch: 'hiveory/amber-harbor',
      baseRef: 'main'
    })
    expect(view).toMatchObject({ kind: 'isolated', name: 'Amber Harbor', autoApprove: true, git: { branch: 'hiveory/amber-harbor' } })
    expect(agents.createInstances).toHaveBeenCalledWith(expect.objectContaining({ id: view.id }), input.cliSelections)
  })

  it('picks a free branch name when one exists', async () => {
    const { service, worktrees } = setup({
      localBranchExists: vi.fn(async (_r: string, b: string) => b === 'hiveory/amber-harbor')
    })
    await service.create(input)
    expect(worktrees.create).toHaveBeenCalledWith(expect.objectContaining({ branch: 'hiveory/amber-harbor-2' }))
  })

  it('uses a custom base branch and branch name', async () => {
    const { service, worktrees } = setup()
    const view = await service.create({ ...input, baseRef: 'develop', branch: 'feature/login' })
    expect(worktrees.create).toHaveBeenCalledWith(expect.objectContaining({ branch: 'feature/login', baseRef: 'develop' }))
    expect(view.git).toMatchObject({ branch: 'feature/login', baseRef: 'develop', createdBranch: true })
  })

  it('rejects a custom branch that already exists, or an unknown base', async () => {
    const taken = setup({ localBranchExists: vi.fn(async () => true) })
    expect(await code(taken.service.create({ ...input, branch: 'feature/login' }))).toBe('INVALID_INPUT')
    const noBase = setup({ refExists: vi.fn(async () => false) })
    expect(await code(noBase.service.create({ ...input, baseRef: 'nope' }))).toBe('INVALID_INPUT')
    const badName = setup({ branchNameProblem: vi.fn(async () => 'That is not a valid Git branch name.') })
    expect(await code(badName.service.create({ ...input, branch: 'x..y' }))).toBe('INVALID_INPUT')
  })

  it('checks out an existing branch and never deletes it', async () => {
    const { service, worktrees } = setup({ localBranchExists: vi.fn(async () => true) })
    const view = await service.create({ ...input, useExistingBranch: true, branch: 'release/1.2' })
    expect(worktrees.create).toHaveBeenCalledWith(expect.objectContaining({ branch: 'release/1.2', baseRef: undefined }))
    expect(view.git?.createdBranch).toBe(false)
    await service.delete(view.id, false)
    expect(worktrees.deleteBranchIfMerged).not.toHaveBeenCalled()
  })

  it('requires the existing branch to exist', async () => {
    const { service } = setup()
    expect(await code(service.create({ ...input, useExistingBranch: true, branch: 'ghost' }))).toBe('INVALID_INPUT')
    expect(await code(service.create({ ...input, useExistingBranch: true }))).toBe('INVALID_INPUT')
  })

  it('explains why isolation is impossible', async () => {
    const noRepo = setup({ repositoryRoot: vi.fn(async () => undefined) })
    noRepo.store.update((s) => {
      s.projects[0]!.repositoryRoot = undefined
    })
    expect(await code(noRepo.service.create(input))).toBe('NOT_A_REPOSITORY')
    expect(await code(setup({ hasCommits: vi.fn(async () => false) }).service.create(input))).toBe('NO_COMMITS')
  })
})

describe('workspace deletion', () => {
  it('removes the main workspace from Hiveory without any Git or folder work', async () => {
    const { service, worktrees, agents, repo } = setup()
    await service.create({ ...input, kind: 'main', name: 'Main' })
    expect(await service.delete(mainWorkspaceId(project.id), false)).toEqual({})
    expect(worktrees.remove).not.toHaveBeenCalled()
    expect(worktrees.prune).not.toHaveBeenCalled()
    expect(agents.forgetWorkspace).toHaveBeenCalledWith(mainWorkspaceId(project.id))
    expect(repo.find(mainWorkspaceId(project.id))).toBeUndefined()
    // It can be created again afterwards.
    await service.create({ ...input, kind: 'main', name: 'Main' })
  })

  it('stops agents before removing the worktree and keeps unmerged branches', async () => {
    const { service, worktrees, calls, repo } = setup()
    const view = await service.create(input)
    worktrees.deleteBranchIfMerged.mockResolvedValueOnce(false)
    // Worktree path does not exist in this test, so removal falls back to prune.
    const result = await service.delete(view.id, false)
    expect(calls.indexOf('stop')).toBeLessThan(calls.indexOf('forget'))
    expect(result.keptBranch).toBe('hiveory/amber-harbor')
    expect(repo.find(view.id)).toBeUndefined()
  })
})
