import { randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import type { Project } from '@shared/domain'
import { AppException, fail } from '@shared/errors'
import type { AgentService } from '../agents/agent-service'
import type { Emit } from '../events'
import { nowIso } from '../events'
import { GitCommandError, type GitService } from '../git/git-service'
import type { StateStore } from '../persistence/state-store'

const samePath = (a: string, b: string): boolean =>
  process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b

/** Opening a Project never creates a Workspace, worktree, branch or agent (STARTER_PROMPT §3). */
export class ProjectService {
  constructor(
    private readonly store: StateStore,
    private readonly git: GitService,
    private readonly agents: AgentService,
    private readonly emit: Emit
  ) {}

  list(): Project[] {
    return [...this.store.state.projects]
  }

  get(projectId: string): Project {
    const project = this.store.state.projects.find((p) => p.id === projectId)
    if (!project) fail('NOT_FOUND', 'Project not found.')
    return project!
  }

  async open(folder: string): Promise<Project> {
    const path = resolve(folder)
    try {
      if (!statSync(path).isDirectory()) throw new Error('not a directory')
    } catch {
      fail('NOT_FOUND', 'That folder does not exist.', { operation: 'Open project' })
    }
    const existing = this.store.state.projects.find((p) => samePath(p.path, path))
    if (existing) return this.touch(existing.id)

    const now = nowIso()
    const project: Project = {
      id: randomUUID(),
      name: basename(path) || path,
      path,
      repositoryRoot: await this.git.repositoryRoot(path),
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now
    }
    this.store.update((s) => {
      s.projects.push(project)
    })
    this.emit('state.changed', { topic: 'projects' })
    return project
  }

  touch(projectId: string): Project {
    this.get(projectId)
    const now = nowIso()
    this.store.update((s) => {
      const p = s.projects.find((x) => x.id === projectId)
      if (p) p.lastOpenedAt = now
    })
    this.emit('state.changed', { topic: 'projects' })
    return this.get(projectId)
  }

  /** Turns a plain folder into a Git repository so isolated workspaces become possible. */
  async initRepository(projectId: string, commit: boolean): Promise<Project> {
    const project = this.get(projectId)
    const existing = await this.git.repositoryRoot(project.path)
    try {
      if (existing) {
        if (commit && !(await this.git.hasCommits(existing))) await this.git.init(existing, true)
      } else {
        await this.git.init(project.path, commit)
      }
    } catch (error) {
      if (error instanceof AppException) throw error
      const detail = error instanceof GitCommandError ? error.stderr.trim() : String(error)
      fail('GIT_FAILED', commit ? 'Git could not create the first commit.' : 'Git could not initialize this folder.', {
        operation: 'Initialize Git',
        hint: /tell me who you are|user\.email|user\.name/i.test(detail)
          ? 'Set your Git name and email (git config --global user.name / user.email), then try again.'
          : undefined,
        detail
      })
    }
    const repositoryRoot = await this.git.repositoryRoot(project.path)
    this.store.update((s) => {
      const p = s.projects.find((x) => x.id === projectId)
      if (p) Object.assign(p, { repositoryRoot, updatedAt: nowIso() })
    })
    this.emit('state.changed', { topic: 'projects' })
    return this.get(projectId)
  }

  /** Removes the Project from Hiveory. Files and worktrees on disk are left untouched. */
  remove(projectId: string): void {
    this.get(projectId)
    this.agents.forgetProject(projectId)
    this.store.update((s) => {
      const workspaceIds = new Set(s.workspaces.filter((w) => w.projectId === projectId).map((w) => w.id))
      s.projects = s.projects.filter((p) => p.id !== projectId)
      s.workspaces = s.workspaces.filter((w) => w.projectId !== projectId)
      for (const id of Object.keys(s.layouts)) {
        if (workspaceIds.has(id) || id.startsWith(projectId)) delete s.layouts[id]
      }
    })
    this.emit('state.changed', { topic: 'projects' })
  }
}
