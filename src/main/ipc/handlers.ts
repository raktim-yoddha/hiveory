import { BrowserWindow, app, clipboard, desktopCapturer, dialog, nativeImage, safeStorage, shell } from 'electron'
import { connectAndSave, discover } from '../app/client'
import { suggestHosts } from '../services/hosts/ssh-config'
import { relaunch } from '../app/client-mode'
import { HOST_PROTOCOL } from '@shared/host/protocol'
import { hostKey, hostLabel, isOpenableUrl, lastWords, type AgentSession } from '@shared/domain'
import { fail } from '@shared/errors'
import type { Container } from '../app/container'
import { WALLPAPER_EXTENSIONS } from '../services/appearance/wallpaper-service'
import { buildBoard } from '../services/kanban/build-board'
import type { Handlers } from './router'
import { deliverMessage } from '../services/agent-tools/deliver'
import { join } from 'node:path'
import type { Project } from '@shared/domain'
import { samePath } from '../services/projects/project-service'
import { AVATAR_EXTENSIONS, avatarFromFile, avatarFromUrl } from '../services/projects/avatar'
import { CODE_HOST_INFO } from '@shared/domain/integrations'
import type { HostRef } from '@shared/domain'
import type { CodeHost } from '../services/git/code-host'
import { openInApps, openInEditor } from '../services/editors/external-editors'

/** Why a Workspace has no reviews when its settings turned the code host off (ADR 0040). */
const CODE_HOST_OFF = "The code host is turned off in this workspace's settings."

/** The machine a remote project lives on (ports exist only there). */
const remoteHost = (c: Container, projectId: string): HostRef => {
  const host = c.projects.get(projectId).host
  if (!host) fail('INVALID_INPUT', 'This workspace is on this computer; its ports need no forwarding.')
  return host!
}

/** Maps each contract channel onto an application service. No logic lives here. */
/**
 * `trustPaths`: requests from a paired client of this machine's Hiveory server name
 * folders on this machine directly (there is no picker to choose them with).
 */
export const createHandlers = (c: Container, options: { trustPaths?: boolean } = {}): Handlers => {
  const repoRootOf = async (projectId: string): Promise<string | undefined> => {
    const project = c.workspaceRepo.project(projectId)
    return project.repositoryRoot ?? (await (await c.hosts.kit(project.host)).git.repositoryRoot(project.path))
  }
  /** GitHub runs this computer's gh against a local checkout; remote projects use it from their own terminals. */
  const localOnly = (projectId: string, what: string): void => {
    if (c.workspaceRepo.project(projectId).host) fail('INVALID_INPUT', `${what} works for workspaces on this computer.`, { hint: 'Use gh in a terminal on that machine.' })
  }
  const requireRepoRoot = async (projectId: string): Promise<string> =>
    (await repoRootOf(projectId)) ?? fail('NOT_A_REPOSITORY', 'This workspace is not a Git repository.')
  /** The Workspace's code host (ADR 0040) and its repository root, or why it has none. */
  /** A worktree's code host, folder and branch: a linked worktree's own, or the Primary's current one. */
  const reviewTarget = async (workspaceId: string) => {
    const workspace = c.workspaceRepo.get(workspaceId)
    localOnly(workspace.projectId, 'Pull requests')
    const { host, root } = await requireHost(workspace.projectId)
    const path = workspace.git?.worktreePath ?? workspace.path
    const name = workspace.kind === 'isolated' ? workspace.git?.branch : await c.git.currentBranch(path)
    const branch = name ? { name, isDefault: workspace.kind === 'main' && name === (await c.git.defaultBranch(root)) } : undefined
    return { host, root, path, branch }
  }
  const requireHost = async (projectId: string): Promise<{ host: CodeHost; root: string }> => {
    const root = await requireRepoRoot(projectId)
    const host = (await c.integrations.hostFor(c.workspaceRepo.project(projectId), root)) ?? fail('INVALID_INPUT', CODE_HOST_OFF)
    return { host, root }
  }

  /** The project folder for a project-scoped skill action (by id, or the project a scanned skill lives in). */
  const projectPathOf = (projectId?: string, skillPath?: string): string | undefined => {
    if (projectId) return c.workspaceRepo.project(projectId).path
    if (!skillPath) return undefined
    return c.projects.list().map((p) => p.path).find((root) => skillPath.startsWith(root))
  }

  /** A scope's folder (workspace, else project) and the id its events use. */
  const folderOf = (scope: { workspaceId?: string; projectId?: string }): { root: string; key: string; projectId: string } =>
    scope.workspaceId
      ? { root: c.workspaceRepo.get(scope.workspaceId).path, key: scope.workspaceId, projectId: c.workspaceRepo.get(scope.workspaceId).projectId }
      : { root: c.workspaceRepo.project(scope.projectId!).path, key: scope.projectId!, projectId: scope.projectId! }
  /** The folder plus the file service of its machine: this computer, or the project's SSH host (ADR 0022). */
  const filesOf = async (scope: { workspaceId?: string; projectId?: string }) => {
    const folder = folderOf(scope)
    const kit = await c.hosts.kit(c.workspaceRepo.project(folder.projectId).host)
    return { ...folder, files: kit.files, remote: kit.remote }
  }

  /**
   * Folders the user chose in a picker this session (plus the default parent):
   * the renderer can only add projects from these, never name any folder itself.
   */
  const picked = new Set<string>()
  const defaultParent = (): string => join(app.getPath('home'), 'Hiveory', 'projects')
  const chosen = (path: string): string => {
    if (options.trustPaths) return path
    if (![...picked, defaultParent()].some((p) => samePath(p, path))) fail('FORBIDDEN', 'Choose the folder with the picker first.')
    return path
  }
  /** Opens (or brings back) a Workspace, then matches its Worktrees to Git: Primary and every worktree (ADR 0038). */
  const addProject = async (path: string, name?: string): Promise<Project> => {
    const project = await c.projects.open(path, name)
    await c.workspaces.sync(project.id).catch((error) => c.log.warn(`Worktree sync failed for ${project.name}`, error))
    return project
  }

  const pickPath = async (sender: Electron.WebContents, options: Electron.OpenDialogOptions): Promise<string | undefined> => {
    const window = BrowserWindow.fromWebContents(sender)
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    return result.canceled ? undefined : result.filePaths[0]
  }

  return {
  // Answered by the window's own machine (NativeShell, ADR 0061); a paired device never reaches these.
  'app.notify': () => fail('INVALID_INPUT', 'Notifications are shown by the window.'),
  'app.setAttention': () => undefined,
  'app.pendingLink': () => null,
  'app.setRecent': () => undefined,
  'agents.attention': () => ({ waiting: c.attention() }),
  'app.info': () => ({
    platform: process.platform as 'win32' | 'darwin' | 'linux',
    version: app.getVersion(),
    hooksAvailable: Boolean(c.hookServer.endpoint),
    isDev: !app.isPackaged
  }),

  'projects.list': () => c.projects.list(),
  'projects.open': async (_input, event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = { title: 'Open workspace', properties: ['openDirectory', 'createDirectory'] as const }
    const result = window
      ? await dialog.showOpenDialog(window, { ...options, properties: [...options.properties] })
      : await dialog.showOpenDialog({ ...options, properties: [...options.properties] })
    const folder = result.filePaths[0]
    return result.canceled || !folder ? null : addProject(folder)
  },
  'projects.pickFolder': async ({ purpose }, event) => {
    const folder = await pickPath(event.sender, {
      title: purpose === 'project' ? 'Choose the workspace folder' : 'Choose where it goes',
      properties: ['openDirectory', 'createDirectory']
    })
    if (folder) picked.add(folder)
    return folder ?? null
  },
  'projects.addDefaults': async () => ({ parentDir: defaultParent(), github: await c.repositories.githubAccount() }),
  'projects.add': async (input) => {
    if (input.mode === 'remote') {
      const project = await c.projects.openRemote({ kind: 'ssh', destination: input.destination, ...(input.port ? { port: input.port } : {}) }, input.path, input.name)
      await c.workspaces.sync(project.id).catch((error) => c.log.warn(`Worktree sync failed for ${project.name}`, error))
      return project
    }
    if (input.mode === 'folder') return addProject(chosen(input.path), input.name)
    if (input.mode === 'clone') return addProject(await c.repositories.clone(input.url, chosen(input.parentDir)), input.name)
    const created = await c.repositories.create(input.repoName, chosen(input.parentDir), input.github)
    const project = await addProject(created.path, input.name)
    if (created.warning) c.emit('app.notice', { level: 'warning', message: created.warning })
    return project
  },
  'projects.remove': ({ projectId }) => c.projects.remove(projectId),
  'projects.touch': ({ projectId }) => c.projects.touch(projectId),
  'projects.update': ({ projectId, ...patch }) => c.projects.update(projectId, patch),

  'workspaces.list': ({ projectId }) => c.workspaces.list(projectId),
  'workspaces.suggestName': ({ projectId }) => c.workspaces.suggestName(projectId),
  'workspaces.create': async (input) => {
    const workspace = await c.workspaces.create(input)
    c.projects.markActive(workspace.projectId)
    return workspace
  },
  // The Primary is the Workspace itself: removing it removes the Workspace (archived, nothing on disk changes; ADR 0038).
  'workspaces.delete': async ({ workspaceId, force }) => {
    const workspace = c.workspaceRepo.get(workspaceId)
    if (workspace.kind !== 'main') return c.workspaces.delete(workspaceId, force ?? false)
    c.projects.remove(workspace.projectId)
    return {}
  },

  'clis.list': async (input) => {
    const host = input?.projectId ? c.workspaceRepo.project(input.projectId).host : undefined
    return host ? (await c.hosts.kit(host)).registry.list(input?.refresh ?? false) : c.registry.list(input?.refresh ?? false)
  },

  'agents.list': ({ workspaceId }) => c.agents.list(workspaceId),
  'agents.open': async ({ workspaceId, cliId, placement, resumeSession, chatUi }) => {
    const opened = await c.agents.open(workspaceId, cliId, placement, resumeSession, chatUi)
    c.projects.markActive(opened.agent.projectId)
    return opened
  },
  'usage.report': ({ days }) => c.usage.report(days),
  // A Workspace on an SSH host lists that host's sessions; All adds every connected host's (ADR 0043).
  'sessions.list': async ({ scope, workspaceId, projectId }) => {
    const on = async (host: HostRef | undefined, folders?: string[]): Promise<AgentSession[]> => {
      if (!host) return c.sessions.list(folders)
      try {
        return await (await c.hosts.kit(host)).sessions.list(folders)
      } catch (error) {
        c.log.warn(`Could not read sessions on ${hostLabel(host)}`, error)
        return []
      }
    }
    if (scope === 'all') {
      const hosts = new Map(c.projects.list().flatMap((p) => (p.host && c.hosts.connected(p.host) ? [[hostKey(p.host), p.host] as const] : [])))
      const lists = await Promise.all([c.sessions.list(), ...[...hosts.values()].map((host) => on(host))])
      return lists.flat().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    }
    if (scope === 'workspace') {
      if (!workspaceId) return []
      const worktree = c.workspaceRepo.get(workspaceId)
      return on(c.workspaceRepo.project(worktree.projectId).host, [worktree.path])
    }
    if (!projectId) return []
    const project = c.workspaceRepo.project(projectId)
    const main = c.workspaceRepo.main(project)
    return on(project.host, [project.path, ...(main ? [main.path] : []), ...c.workspaceRepo.isolated(projectId).map((w) => w.path)])
  },
  'agents.close': ({ instanceId }) => c.agents.close(instanceId),
  'agents.rename': ({ instanceId, name }) => c.agents.rename(instanceId, name),
  'agents.restart': ({ instanceId }) => c.agents.restart(instanceId),
  'agents.sendMessage': ({ instanceId, message }) => {
    const agent = c.agents.find(instanceId) ?? fail('NOT_FOUND', 'That agent is no longer open.')
    return deliverMessage({ agents: c.agents, runtime: c.runtime, chats: c.chats }, agent, message).catch((error: unknown) =>
      fail('INVALID_INPUT', error instanceof Error ? error.message : String(error))
    )
  },
  'agents.interrupt': ({ instanceId }) => c.agents.interrupt(instanceId),
  'agents.peek': ({ instanceId }) => {
    const agent = c.agents.find(instanceId) ?? fail('NOT_FOUND', 'That agent is no longer open.')
    const details = c.agents.details(agent)
    const excerpt = lastWords(agent.chatUi ? c.chats.lastReply(agent.id) : c.runtime.screenText(agent.id, 60))
    return {
      petName: agent.petName,
      status: details.status,
      running: details.running,
      ...(details.waitingReason ? { waitingReason: details.waitingReason } : {}),
      ...(details.activity ? { activity: details.activity } : {}),
      ...(excerpt ? { excerpt } : {})
    }
  },
  'agents.applyPreset': ({ workspaceId, presetId }) => {
    const preset = c.presets.get(presetId)
    c.agents.applyPreset(workspaceId, preset.cliSelections, preset.autoApprove)
  },

  // Terminal ids belong either to an agent (runtime) or a sidebar shell.
  'terminal.write': ({ instanceId, data }) =>
    c.shells.has(instanceId) ? c.shells.write(instanceId, data) : c.runtime.write(instanceId, data),
  'terminal.resize': ({ instanceId, cols, rows }) =>
    c.shells.has(instanceId) ? c.shells.resize(instanceId, cols, rows) : c.runtime.resize(instanceId, cols, rows),
  'terminal.snapshot': ({ instanceId }) =>
    c.shells.has(instanceId) ? c.shells.snapshot(instanceId) : c.runtime.snapshot(instanceId),

  'layout.get': ({ workspaceId }) => c.layouts.get(workspaceId, c.agents.paneIds(workspaceId)),
  'layout.apply': ({ workspaceId, operation }) =>
    c.layouts.apply(workspaceId, c.agents.paneIds(workspaceId), operation),

  'presets.list': () => c.presets.list(),
  'presets.save': (input) => c.presets.save(input),
  'presets.delete': ({ presetId }) => c.presets.delete(presetId),

  'settings.get': () => c.settings.get(),
  'settings.update': (patch) => c.settings.update(patch),
  'terminalHost.status': () => c.localHost.status(),
  // Every terminal ends with it; agents come back resuming their conversations, as after a reboot.
  'terminalHost.restart': async () => {
    await c.localHost.restart()
    c.agents.resumeAll()
    return c.localHost.status()
  },
  'updates.status': () => c.updates.current(),
  'updates.check': () => c.updates.check(),
  'updates.download': () => c.updates.download(),
  'updates.install': () => c.updates.install(),

  'system.editorApps': () => openInApps(),
  'system.openIn': ({ workspaceId, appId }) => {
    const workspace = c.workspaceRepo.get(workspaceId)
    if (c.workspaceRepo.project(workspace.projectId).host) fail('INVALID_INPUT', 'That folder is on another machine.')
    if (!openInEditor(appId, workspace.path)) fail('NOT_FOUND', 'That editor is not installed.')
  },
  'system.revealPath': async ({ projectId, workspaceId }) => {
    const folder = workspaceId
      ? c.workspaceRepo.get(workspaceId).path
      : projectId
        ? c.workspaceRepo.project(projectId).path
        : fail('INVALID_INPUT', 'Nothing to reveal.')
    const projectOf = workspaceId ? c.workspaceRepo.get(workspaceId).projectId : projectId!
    if (c.workspaceRepo.project(projectOf).host) fail('INVALID_INPUT', 'That folder is on another machine.', { hint: 'Browse it in the Explorer instead.' })
    const error = await shell.openPath(folder)
    if (error) fail('NOT_FOUND', 'Could not open the folder.', { detail: error })
  },
  'clipboard.readText': () => clipboard.readText(),
  'clipboard.writeText': ({ text }) => clipboard.writeText(text),

  'shell.open': ({ workspaceId, projectId, tab }) => {
    // Each side-panel tab is its own shell; no tab = the workspace's default shell (also used by agent tools).
    const suffix = tab ? `-${tab}` : ''
    if (workspaceId) return c.shells.open(workspaceId + suffix, c.workspaceRepo.get(workspaceId).path)
    if (projectId) return c.shells.open(projectId + suffix, c.workspaceRepo.project(projectId).path)
    return fail('INVALID_INPUT', 'Choose a workspace or worktree first.')
  },
  'shell.restart': ({ id }) => c.shells.restart(id),
  'shell.close': ({ id }) => c.shells.close(id),

  'extensions.scan': ({ projectId }) => c.extensions.scan(projectPathOf(projectId)),
  'extensions.revealSkill': async ({ path }) => {
    const error = await shell.openPath(c.extensions.skillFolder(path))
    if (error) fail('NOT_FOUND', 'Could not open the folder.', { detail: error })
  },
  'extensions.copySkill': ({ path, rootId }) => {
    c.extensions.copySkill(path, rootId, projectPathOf(undefined, path))
  },
  'extensions.removeSkill': ({ path }) => c.extensions.removeSkill(path),
  'extensions.createSkill': ({ projectId, ...input }) => {
    c.extensions.createSkill(input, projectPathOf(projectId))
  },
  'projects.pickAvatar': async ({ projectId }, event) => {
    const file = await pickPath(event.sender, { title: 'Choose an avatar image', properties: ['openFile'], filters: [{ name: 'Images', extensions: AVATAR_EXTENSIONS }] })
    return file ? c.projects.update(projectId, { settings: { avatar: avatarFromFile(file, nativeImage), emoji: null } }) : null
  },
  // The Workspace's code host avatar (ADR 0043, 0044): GitHub's or GitLab's, as its settings or remote say.
  'projects.githubAvatar': async ({ projectId }) => {
    const project = c.workspaceRepo.project(projectId)
    const root = project.host ? undefined : await repoRootOf(projectId)
    const host = (root ? await c.integrations.hostFor(project, root) : null) ?? c.github
    const url = await host.avatarUrl(root)
    if (!url) return fail('INVALID_INPUT', `No ${CODE_HOST_INFO[host.id].name} account found.`, { hint: `Sign in with "${CODE_HOST_INFO[host.id].signIn}", or use a repository on ${CODE_HOST_INFO[host.id].name}.` })
    // A private project's avatar needs a login the fetch doesn't have: the account's avatar instead.
    const avatar = await avatarFromUrl(url, nativeImage).catch(async (error: unknown) => {
      const account = root ? await host.avatarUrl(undefined) : undefined
      if (!account || account === url) throw error
      return avatarFromUrl(account, nativeImage)
    })
    return c.projects.update(projectId, { settings: { avatar, emoji: null } })
  },
  'extensions.importSkill': async ({ rootIds, projectId }, event) => {
    const folder = await pickPath(event.sender, { title: 'Choose a skill folder (with SKILL.md)', properties: ['openDirectory'] })
    if (!folder) return false
    c.extensions.importSkill(folder, rootIds, projectPathOf(projectId))
    return true
  },

  'store.searchSkills': ({ query }) => c.stores.searchSkills(query),
  'store.topSkills': () => c.stores.topSkills(),
  'store.skillAudits': ({ id }) => c.stores.skillAudits(id),
  'store.installSkill': async ({ source, skillId, rootIds, projectId }) => {
    c.extensions.installFiles(await c.stores.downloadSkill(source, skillId), rootIds, projectPathOf(projectId))
  },
  'store.searchMcp': ({ query, cursor }) => c.stores.searchMcp(query, cursor),

  'system.openUrl': async ({ url }) => {
    if (!isOpenableUrl(url)) fail('FORBIDDEN', 'Hiveory only opens its help and store pages from here.')
    await shell.openExternal(url)
  },
  // Files run where the folder is: this computer, or the project's SSH host (ADR 0022).
  'files.list': async ({ scope, dir }) => {
    const { root, files } = await filesOf(scope)
    return { root, entries: await files.list(root, dir) }
  },
  'files.search': async ({ scope, query }) => {
    const { root, files } = await filesOf(scope)
    return files.search(root, query)
  },
  'files.read': async ({ scope, path }) => {
    const { root, files } = await filesOf(scope)
    return files.read(root, path)
  },
  'files.write': async ({ scope, path, content }) => {
    const { root, files } = await filesOf(scope)
    return files.write(root, path, content)
  },
  'files.create': async ({ scope, path, kind }) => {
    const { root, files } = await filesOf(scope)
    return files.create(root, path, kind)
  },
  'files.rename': async ({ scope, from, to }) => {
    const { root, files } = await filesOf(scope)
    await files.rename(root, from, to)
    if (scope.workspaceId) c.editors.renamed(scope.workspaceId, from, to)
  },
  'files.delete': async ({ scope, paths }) => {
    const { root, files } = await filesOf(scope)
    return files.remove(root, paths)
  },
  'files.paste': async ({ scope, sources, targetDir, mode }) => {
    const { root, files } = await filesOf(scope)
    return files.paste(root, sources, targetDir, mode)
  },
  'files.reveal': async ({ scope, path }) => {
    const { root, files, remote } = await filesOf(scope)
    if (remote) fail('INVALID_INPUT', 'That file is on another machine.', { hint: 'Open it from the Explorer instead.' })
    shell.showItemInFolder(await files.resolveIn(root, path))
  },
  'files.watch': async ({ scope, watch }) => {
    const { root, key, files } = await filesOf(scope)
    await files.watch(key, root, watch)
  },
  'editors.list': ({ workspaceId }) => c.editors.list(workspaceId),
  'editors.openReview': ({ workspaceId, targetPaneId, side }) => {
    c.workspaceRepo.get(workspaceId)
    return c.editors.openReview(workspaceId, targetPaneId && side ? { targetPaneId, side } : undefined)
  },
  'editors.open': async ({ workspaceId, path, targetPaneId, side }) => {
    const { root, files } = await filesOf({ workspaceId })
    await files.resolveIn(root, path)
    return c.editors.open(workspaceId, path, targetPaneId && side ? { targetPaneId, side } : undefined)
  },
  'editors.close': ({ editorId }) => c.editors.close(editorId),
  'connections.list': () => c.connections.list(),
  'apps.status': () => c.apps.status(),
  'apps.setKey': ({ apiKey }) => c.apps.setKey(apiKey),
  'apps.removeKey': () => c.apps.removeKey(),
  'apps.connect': ({ appId, label }) => c.apps.connect(appId, label),
  'apps.disconnect': ({ accountId }) => c.apps.disconnect(accountId),
  'connections.saveCustom': (input) => c.connections.saveCustom(input),
  'connections.import': ({ name }) => {
    const { config, from } = c.extensions.rawServer(name)
    return c.connections.importServer(name, config, from)
  },
  'connections.setEnabled': ({ id, enabled }) => c.connections.setEnabled(id, enabled),
  'connections.test': ({ id }) => c.connections.test(id),
  'connections.remove': ({ id }) => c.connections.remove(id),

  'wallpapers.list': () => c.wallpapers.list(),
  'wallpapers.add': async (_input, event) => {
    const file = await pickPath(event.sender, {
      title: 'Choose a wallpaper',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: WALLPAPER_EXTENSIONS }]
    })
    return file ? c.wallpapers.add(file) : null
  },
  'wallpapers.remove': ({ file }) => {
    if (c.settings.get().wallpaper === `image:${file}`) c.settings.update({ wallpaper: '' })
    c.wallpapers.remove(file)
  },

  'themes.search': ({ query, offset }) => c.themes.search(query, offset),
  'themes.installed': () => c.themes.list(),
  'themes.install': ({ namespace, name }) => c.themes.install(namespace, name),
  'themes.remove': ({ id }) => {
    if (c.settings.get().vscodeTheme.startsWith(`${id}/`)) c.settings.update({ vscodeTheme: '' })
    c.themes.remove(id)
  },

  'browser.state': () => c.browser.state(),
  'browser.open': ({ scope, url, profileId, beside }) => {
    const page = c.browser.open({ scope, url, profileId })
    if (beside && c.workspaceRepo.find(scope)) {
      const operation = beside.side === 'tab' ? { type: 'stack' as const, paneId: page.id, targetPaneId: beside.paneId } : { type: 'move' as const, paneId: page.id, targetPaneId: beside.paneId, side: beside.side }
      c.layouts.apply(scope, c.agents.paneIds(scope), operation)
    }
    return page
  },
  'browser.close': ({ pageId }) => c.browser.close(pageId),
  'browser.navigate': ({ pageId, url }) => c.browser.navigate(pageId, url),
  'browser.show': ({ pageId, bounds, freeze }) => c.browser.show(pageId, bounds, freeze ?? false),
  'browser.viewport': ({ pageId, viewport }) => c.browser.setViewport(pageId, viewport),
  'browser.devtools': ({ pageId }) => c.browser.toggleDevTools(pageId),
  'browser.openExternal': async ({ pageId }) => {
    const url = c.browser.state().pages.find((p) => p.id === pageId)?.url ?? ''
    if (!/^https?:\/\//i.test(url)) fail('INVALID_INPUT', 'Only web pages can open in your browser.')
    await shell.openExternal(url)
  },
  'browser.pick': ({ pageId }) => c.browser.pick(pageId),
  'browser.cancelPick': async ({ pageId }) => {
    await c.browser.cancelPick(pageId)
  },
  'browser.annotate': ({ pageId, element, note, intent }) => c.browser.annotate(pageId, element, note, intent),
  'browser.deleteAnnotation': ({ id }) => c.browser.deleteAnnotations(id),
  'browser.askNote': ({ pageId, ...opts }) => c.browser.askNote(pageId, opts),
  'browser.updateAnnotation': ({ id, note, intent }) => c.browser.updateAnnotation(id, note, intent),
  'browser.switchProfile': ({ pageId, profileId }) => c.browser.switchProfile(pageId, profileId),
  'browser.createProfile': ({ name }) => c.browser.createProfile(name),
  'browser.renameProfile': ({ profileId, name }) => c.browser.renameProfile(profileId, name),
  'browser.deleteProfile': ({ profileId }) => c.browser.deleteProfile(profileId),
  'browser.clearData': ({ profileId }) => c.browser.clearData(profileId),
  'browser.importCookies': async ({ profileId }, event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: 'Import cookies',
      properties: ['openFile' as const],
      filters: [{ name: 'Cookie export (JSON or cookies.txt)', extensions: ['json', 'txt'] }]
    }
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    const file = result.filePaths[0]
    return result.canceled || !file ? null : c.browser.importCookies(profileId, file)
  },
  'browser.exportCookies': async ({ profileId }, event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = { title: 'Export cookies', defaultPath: `cookies-${profileId}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] }
    const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    return { count: await c.browser.exportCookies(profileId, result.filePath), path: result.filePath }
  },
  'browser.clearCookies': async ({ profileId }) => ({ count: await c.browser.clearCookies(profileId) }),

  'chat.clis': () => c.chats.clis(),
  'chat.get': ({ chatId }) => ({ ...c.chats.get(chatId), running: c.chats.isRunning(chatId) }),
  'chat.update': ({ chatId, ...patch }) => {
    const chat = c.chats.update(chatId, patch)
    // A chat-view agent's CLI follows its chat's (ADR 0058): the pane, board and tools show the new one.
    if (chat.agentId && chat.cliId) c.agents.followChatCli(chat.agentId, chat.cliId)
    return chat
  },
  'chat.setModel': ({ chatId, model, effort }) => c.chats.update(chatId, { model, effort }),
  'chat.send': ({ chatId, text, attachments }) => c.chats.send(chatId, text, attachments ?? []),
  'chat.queue': ({ chatId, text }) => c.chats.enqueue(chatId, text),
  'chat.unqueue': ({ chatId, index }) => c.chats.unqueue(chatId, index),
  'prompts.list': () => c.prompts.list(),
  'prompts.save': (input) => c.prompts.save(input),
  'prompts.delete': ({ promptId }) => c.prompts.delete(promptId),
  'chat.attach': ({ chatId, name, mime, data }) => c.chats.attach(chatId, name, mime, data),
  'chat.attachPath': ({ chatId, path }) => c.chats.attachPath(chatId, path),
  'chat.stop': ({ chatId }) => c.chats.stop(chatId),
  'chat.catalog': ({ cliId, refresh }) => c.chats.catalog(cliId, refresh ?? false),
  'chat.limits': ({ cliId, refresh }) => c.chats.limits(cliId, refresh ?? false),
  'chat.revertTurn': ({ chatId, messageId }) => c.chats.revertTurn(chatId, messageId),
  // A picture of one open window, attached to the draft (ADR 0058); thumbnails only list them.
  'chat.windows': async () => {
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 320, height: 200 } })
    return sources.filter((w) => w.name).map((w) => ({ id: w.id, name: w.name, thumbnail: w.thumbnail.toDataURL() }))
  },
  'chat.captureWindow': async ({ sourceId }) => {
    const source = (await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1920, height: 1200 } })).find((w) => w.id === sourceId)
    if (!source || source.thumbnail.isEmpty()) fail('NOT_FOUND', 'That window is gone.')
    return { name: `${source!.name.slice(0, 60) || 'window'}.png`, data: source!.thumbnail.toPNG().toString('base64') }
  },
  'changes.list': ({ workspaceId, source }) => c.changes.list(workspaceId, source),
  'changes.diff': ({ workspaceId, source, path }) => c.changes.diff(workspaceId, source, path),
  'changes.commits': ({ workspaceId }) => c.changes.commits(workspaceId),
  'changes.commit': ({ workspaceId, message }) => c.changes.commit(workspaceId, message),
  'changes.push': ({ workspaceId }) => c.changes.push(workspaceId),
  'changes.discard': ({ workspaceId, paths }) => c.changes.discard(workspaceId, paths),
  // This window runs its own services; connecting pairs with a server and relaunches as its client (ADR 0022).
  'client.status': () => ({ mode: 'local' as const, connected: false }),
  'client.connect': async (input) => {
    const server = await connectAndSave(input, c.sshHosts, c.tailscale, c.paths.clientFile, safeStorage)
    relaunch()
    return { mode: 'client' as const, server, connected: true }
  },
  'client.disconnect': () => undefined,
  'client.discover': () => discover(c.tailscale),
  'share.status': () => c.sharing.status(),
  'share.revoke': ({ deviceId }) => c.sharing.revoke(deviceId),
  'routines.list': () => c.routines.list(),
  'routines.create': (input) => c.routines.create(input),
  'routines.update': ({ routineId, ...patch }) => c.routines.update(routineId, patch),
  'routines.addFile': ({ name, data }) => c.routineFiles.add(name, data),
  'routines.delete': ({ routineId }) => c.routines.delete(routineId),
  'routines.runNow': ({ routineId }) => c.routines.runNow(routineId),
  'routines.runs': (filter) => c.routines.runs(filter),
  'hosts.listDir': async ({ destination, port, path }) => {
    const kit = await c.hosts.kit({ kind: 'ssh', destination, ...(port ? { port } : {}) })
    const dir = !path || path === '~' ? kit.home : path.startsWith('~/') ? kit.paths.join(kit.home, path.slice(2)) : path
    const entries = await kit.fs.readDir(dir)
    return { path: dir, home: kit.home, dirs: entries.filter((e) => e.dir && !e.name.startsWith('.')).map((e) => e.name).sort((a, b) => a.localeCompare(b)) }
  },
  'hosts.suggest': () => suggestHosts(c.tailscale),
  'hosts.status': () => c.hosts.statuses(),
  'ssh.pending': () => c.sshAuth.pending(),
  'ports.list': ({ projectId }) => c.ports.list(remoteHost(c, projectId)),
  'ports.forward': async ({ projectId, port }) => ({ localPort: await c.ports.forward(remoteHost(c, projectId), port) }),
  'ports.stop': ({ projectId, port }) => c.ports.stop(remoteHost(c, projectId), port),
  'ports.open': async ({ projectId, port }) => {
    const local = c.ports.localPort(remoteHost(c, projectId), port)
    if (!local) fail('NOT_FOUND', 'Forward that port first.')
    await shell.openExternal(`http://localhost:${local}/`)
  },
  'ssh.answer': ({ id, answer }) => c.sshAuth.answer(id, answer),
  'hosts.check': async (target) => {
    const { info, installed, nodeInstalled } = await c.sshHosts.deploy(target)
    const { client } = await c.sshHosts.connect(target)
    try {
      const hello = await client.call('hello', { protocol: HOST_PROTOCOL })
      return { platform: info.platform, arch: info.arch, node: info.node, installed, nodeInstalled, protocol: hello.protocol }
    } finally {
      client.close()
    }
  },

  'git.info': ({ projectId, fetch }) => c.workspaces.gitInfo(projectId, fetch),
  'git.validateBranch': async ({ projectId, name }) => {
    const project = c.workspaceRepo.project(projectId)
    const kit = await c.hosts.kit(project.host)
    const repoRoot = project.repositoryRoot ?? (await kit.git.repositoryRoot(project.path))
    if (!repoRoot) return { problem: 'This workspace is not a Git repository.' }
    const problem = await kit.git.branchNameProblem(repoRoot, name)
    if (problem) return { problem }
    return { problem: (await kit.git.localBranchExists(repoRoot, name)) ? `Branch ${name} already exists.` : null }
  },
  'git.init': ({ projectId, commit }) => c.projects.initRepository(projectId, commit),
  'workspaces.gitStatus': ({ workspaceId }) => c.workspaces.gitStatus(workspaceId),
  'workspaces.repair': ({ workspaceId }) => c.workspaces.repair(workspaceId),
  // The github.* channels answer for the Workspace's code host, GitHub or GitLab (ADR 0040).
  'github.status': async ({ projectId }) => {
    const project = c.workspaceRepo.project(projectId)
    if (project.host) return { available: false, reason: 'Pull requests work for workspaces on this computer.' }
    const root = await repoRootOf(projectId)
    if (!root) return { available: false, reason: 'This workspace is not a Git repository.' }
    const host = await c.integrations.hostFor(project, root)
    return host ? host.status(root) : { available: false, reason: CODE_HOST_OFF }
  },
  'github.pullRequests': async ({ projectId }) => {
    localOnly(projectId, 'Pull requests')
    const { host, root } = await requireHost(projectId)
    return host.pullRequests(root)
  },
  'github.issues': async ({ projectId }) => {
    localOnly(projectId, 'Issues')
    const { host, root } = await requireHost(projectId)
    // Older phones read GitHub-style issues; the desktop uses issues.list.
    return (await host.issues(root)).map((i) => ({ number: Number(i.key.replace('#', '')), title: i.title, url: i.url }))
  },
  'github.createPullRequest': async ({ workspaceId, draft }) => {
    const { host, root, path, branch } = await reviewTarget(workspaceId)
    if (!branch) return fail('INVALID_INPUT', 'This worktree is not on a branch.')
    if (branch.isDefault) return fail('INVALID_INPUT', `The Primary is on ${branch.name}, the default branch.`, { hint: 'Switch it to another branch, or use a worktree.' })
    return { url: await host.createPullRequest(root, path, branch.name, draft ?? false) }
  },
  // A worktree's own review (ADR 0064); a detached head or the Primary on the default branch says why it has none.
  'github.pullRequestFor': async ({ workspaceId }) => {
    const { host, path, branch } = await reviewTarget(workspaceId)
    if (!branch) return fail('INVALID_INPUT', 'This worktree is not on a branch.')
    if (branch.isDefault) return fail('INVALID_INPUT', `The Primary is on ${branch.name}, the default branch.`, { hint: 'Pull requests come from a worktree on its own branch: make one with "+".' })
    return host.pullRequestFor(path, branch.name)
  },
  'github.merge': async ({ workspaceId, number, method }) => {
    const { host, path } = await reviewTarget(workspaceId)
    await host.merge(path, number, method)
  },
  'integrations.status': () => c.integrations.status(),
  'integrations.connectJira': async (input) => {
    await c.integrations.trackers.connectJira(input)
    return c.integrations.status()
  },
  'integrations.connectLinear': async ({ apiKey }) => {
    await c.integrations.trackers.connectLinear(apiKey)
    return c.integrations.status()
  },
  'integrations.disconnect': ({ tracker }) => {
    c.integrations.trackers.disconnect(tracker)
    return c.integrations.status()
  },
  'integrations.groups': ({ tracker }) => c.integrations.trackers.groups(tracker),
  'issues.list': async ({ projectId }) => {
    const project = c.workspaceRepo.project(projectId)
    if (project.host && !project.settings?.issueSource) return { issues: [], reason: 'Issues from the code host work for workspaces on this computer.' }
    return c.integrations.issues(project, project.host ? undefined : await repoRootOf(projectId))
  },

  'kanban.board': ({ projectId }) => {
    const mirrors = c.workspaceRepo.mirrors(projectId)
    return buildBoard(
      mirrors,
      // Shells are terminals, not agents: they have no place on the board.
      mirrors.flatMap((id) => c.agents.instancesInProject(id)).filter((i) => c.registry.adapter(i.cliId)?.kind !== 'shell'),
      (workspaceId) => c.workspaceRepo.find(workspaceId)?.name,
      (instanceId) => c.runtime.details(instanceId)
    )
  }
}
}
