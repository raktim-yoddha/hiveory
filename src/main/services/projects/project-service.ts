import { randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import { basename, posix, resolve } from 'node:path'
import { hostKey, type HostRef, type Project, type ProjectSettings } from '@shared/domain'
import type { RequestOf } from '@shared/ipc/contract'
import { AppException, fail } from '@shared/errors'
import type { AgentService } from '../agents/agent-service'
import type { Emit } from '../events'
import { nowIso } from '../events'
import { GitCommandError } from '../git/git-service'
import { MAX_ARCHIVED, type ArchivedProject } from '../persistence/schema'
import type { StateStore } from '../persistence/state-store'
import { mainTreeOwner } from '../workspaces/workspace-repository'

/** A project's activity time moves at most this often. */
const ACTIVE_THROTTLE_MS = 30_000
import type { KitSource } from '../workspaces/workspace-service'

export const samePath = (a: string, b: string): boolean =>
  process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b)

/** The same folder on the same machine: a remote path compares as written, on its own host only. */
const sameFolder = (project: Project, path: string, host?: HostRef): boolean =>
  hostKey(project.host) === hostKey(host) && (host ? project.path === path : samePath(project.path, path))

/** Opening a Project never creates a Workspace, worktree, branch or agent (STARTER_PROMPT §3). */
export class ProjectService {
  constructor(
    private readonly store: StateStore,
    /** The machine a project lives on: this computer, or an SSH host (ADR 0022). */
    private readonly kits: KitSource,
    private readonly agents: AgentService,
    private readonly emit: Emit
  ) {}

  list(): Project[] {
    return [...this.store.state.projects]
  }

  get(projectId: string): Project {
    const project = this.store.state.projects.find((p) => p.id === projectId)
    if (!project) fail('NOT_FOUND', 'Workspace not found.')
    return project!
  }

  /**
   * Adds a folder as a project. A folder that was a project before comes back
   * whole — same workspaces, agents (resuming their conversations), layouts and
   * open files — instead of starting over (ADR 0020).
   */
  async open(folder: string, name?: string): Promise<Project> {
    const path = resolve(folder)
    try {
      if (!statSync(path).isDirectory()) throw new Error('not a directory')
    } catch {
      fail('NOT_FOUND', 'That folder does not exist.', { operation: 'Open workspace' })
    }
    return this.add(path, name)
  }

  /**
   * Adds a folder on a machine reached over SSH (ADR 0022). Its files, git and agents stay
   * there; Hiveory installs its small host program on first use. `~/x` means the login's home.
   */
  async openRemote(host: HostRef, folder: string, name?: string): Promise<Project> {
    const kit = await this.kits.kit(host)
    const raw = folder.trim()
    const path = posix.normalize(raw === '~' || raw.startsWith('~/') ? posix.join(kit.home, raw.slice(1)) : raw).replace(/(.)\/+$/, '$1')
    if (!posix.isAbsolute(path)) fail('INVALID_INPUT', 'Use a full path on that machine, like /home/me/app or ~/app.', { operation: 'Open workspace' })
    if (!(await kit.fs.isDirectory(path))) fail('NOT_FOUND', `${path} is not a folder on ${host.destination}.`, { operation: 'Open workspace' })
    return this.add(path, name, host)
  }

  private async add(path: string, name?: string, host?: HostRef): Promise<Project> {
    const existing = this.store.state.projects.find((p) => sameFolder(p, path, host))
    if (existing) return this.touch(existing.id)
    const archived = this.store.state.archive.find((a) => sameFolder(a.project, path, host))
    if (archived) return this.restore(archived, name)

    const kit = await this.kits.kit(host)
    const now = nowIso()
    const project: Project = {
      id: randomUUID(),
      name: name?.trim() || (host ? posix.basename(path) : basename(path)) || path,
      path,
      repositoryRoot: await kit.git.repositoryRoot(path),
      ...(host ? { host: { kind: 'ssh' as const, destination: host.destination, ...(host.port ? { port: host.port } : {}) } } : {}),
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

  /**
   * Records real work in a project (a turn started, an agent or workspace created) so it
   * rises in the sidebar; opening a project alone does not. Status flips often, so a project
   * that is already the most recent is updated at most every 30 s: that can't change the order.
   */
  markActive(projectId: string | undefined): void {
    const all = this.store.state.projects
    const project = projectId ? all.find((p) => p.id === projectId) : undefined
    if (!project) return
    const now = Date.now()
    const at = (p: Project): number => Date.parse(p.lastActiveAt ?? p.createdAt) || 0
    const newest = all.every((p) => p === project || at(p) <= at(project))
    if (project.lastActiveAt && newest && now - at(project) < ACTIVE_THROTTLE_MS) return
    this.store.update((s) => {
      const p = s.projects.find((x) => x.id === project.id)
      if (p) p.lastActiveAt = new Date(now).toISOString()
    })
    this.emit('state.changed', { topic: 'projects' })
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

  /**
   * Renames a Workspace or changes its settings (ADR 0037). Sent settings replace the stored ones;
   * null puts one back to the app's default.
   */
  update(projectId: string, { name, settings }: Omit<RequestOf<'projects.update'>, 'projectId'>): Project {
    this.get(projectId)
    this.store.update((s) => {
      const p = s.projects.find((x) => x.id === projectId)
      if (!p) return
      if (name !== undefined) p.name = name.trim()
      if (settings) {
        const next: Record<string, unknown> = { ...p.settings }
        for (const [key, value] of Object.entries(settings)) {
          if (value === null) delete next[key]
          else if (value !== undefined) next[key] = value
        }
        p.settings = Object.keys(next).length ? (next as ProjectSettings) : undefined
      }
      p.updatedAt = nowIso()
    })
    this.emit('state.changed', { topic: 'projects' })
    return this.get(projectId)
  }

  /** Turns a plain folder into a Git repository so isolated workspaces become possible. */
  async initRepository(projectId: string, commit: boolean): Promise<Project> {
    const project = this.get(projectId)
    const git = (await this.kits.kit(project.host)).git
    const existing = await git.repositoryRoot(project.path)
    try {
      if (existing) {
        if (commit && !(await git.hasCommits(existing))) await git.init(existing, true)
      } else {
        await git.init(project.path, commit)
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
    const repositoryRoot = await git.repositoryRoot(project.path)
    this.store.update((s) => {
      const p = s.projects.find((x) => x.id === projectId)
      if (p) Object.assign(p, { repositoryRoot, updatedAt: nowIso() })
    })
    this.emit('state.changed', { topic: 'projects' })
    return this.get(projectId)
  }

  /**
   * Removes the Project from Hiveory: its agents stop and it leaves the sidebar.
   * Nothing on disk changes, and nothing is forgotten: the project, its workspaces,
   * agents, layouts and open files are archived, so adding the folder again (or
   * "Restore previous" in Add project) brings them all back (ADR 0020).
   */
  remove(projectId: string): void {
    const project = this.get(projectId)
    this.agents.stopProject(projectId)
    this.store.update((s) => {
      const workspaceIds = new Set(s.workspaces.filter((w) => w.projectId === projectId).map((w) => w.id))
      const layouts: ArchivedProject['layouts'] = {}
      for (const [id, layout] of Object.entries(s.layouts)) {
        if (!workspaceIds.has(id) && !id.startsWith(projectId)) continue
        if (layout) layouts[id] = layout
        delete s.layouts[id]
      }
      const entry: ArchivedProject = {
        project,
        workspaces: s.workspaces.filter((w) => w.projectId === projectId),
        instances: s.instances.filter((i) => i.projectId === projectId),
        layouts,
        editors: s.editors.filter((e) => workspaceIds.has(e.workspaceId)),
        removedAt: nowIso()
      }
      s.archive = [entry, ...s.archive.filter((a) => !sameFolder(a.project, project.path, project.host))].slice(0, MAX_ARCHIVED)
      s.projects = s.projects.filter((p) => p.id !== projectId)
      s.workspaces = s.workspaces.filter((w) => w.projectId !== projectId)
      s.instances = s.instances.filter((i) => i.projectId !== projectId)
      s.editors = s.editors.filter((e) => !workspaceIds.has(e.workspaceId))
    })
    this.emit('state.changed', { topic: 'projects' })
  }

  /** Projects removed earlier that can be restored, newest first. */
  archived(): ArchivedProject[] {
    return [...this.store.state.archive]
  }

  /** Puts an archived project back exactly as it was and resumes its agents. */
  private restore(entry: ArchivedProject, name?: string): Project {
    const now = nowIso()
    const project: Project = { ...entry.project, ...(name?.trim() ? { name: name.trim() } : {}), updatedAt: now, lastOpenedAt: now }
    // Its Main workspace would share a checkout another project already runs agents in (ADR 0021).
    const owner = entry.workspaces.some((w) => w.kind === 'main') ? mainTreeOwner(this.store.state, project) : undefined
    if (owner) {
      fail('INVALID_INPUT', `${project.name}'s Primary worktree uses the same checkout as the ${owner.workspace.name} worktree of ${owner.project.name}.`, {
        operation: 'Restore workspace',
        hint: `Agents run in one place per checkout. Remove ${owner.workspace.name} from ${owner.project.name} (nothing on disk changes), then restore.`
      })
    }
    // Agent names stay unique across projects: a name taken meanwhile keeps its agent out (it would be ambiguous).
    const taken = new Set(this.store.state.instances.map((i) => i.petName.toLowerCase()))
    this.store.update((s) => {
      s.archive = s.archive.filter((a) => a.project.id !== entry.project.id)
      s.projects.push(project)
      s.workspaces.push(...entry.workspaces)
      s.instances.push(...entry.instances.filter((i) => !taken.has(i.petName.toLowerCase())))
      s.editors.push(...entry.editors)
      Object.assign(s.layouts, entry.layouts)
    })
    this.agents.resumeAll(project.id)
    this.emit('state.changed', { topic: 'projects' })
    return project
  }
}
