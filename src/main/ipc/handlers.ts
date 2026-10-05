import { app, BrowserWindow, clipboard, dialog, shell } from 'electron'
import { isPluginHelpUrl } from '@shared/domain'
import { fail } from '@shared/errors'
import type { Container } from '../app/container'
import { WALLPAPER_EXTENSIONS } from '../services/appearance/wallpaper-service'
import { findExecutable, processDiscoveryEnv } from '../services/cli/discovery'
import { buildBoard } from '../services/kanban/build-board'
import type { Handlers } from './router'

/** Maps each contract channel onto an application service. No logic lives here. */
export const createHandlers = (c: Container): Handlers => {
  const repoRootOf = async (projectId: string): Promise<string | undefined> => {
    const project = c.workspaceRepo.project(projectId)
    return project.repositoryRoot ?? (await c.git.repositoryRoot(project.path))
  }
  const requireRepoRoot = async (projectId: string): Promise<string> =>
    (await repoRootOf(projectId)) ?? fail('NOT_A_REPOSITORY', 'This project is not a Git repository.')

  /** The project folder for a project-scoped skill action (by id, or the project a scanned skill lives in). */
  const projectPathOf = (projectId?: string, skillPath?: string): string | undefined => {
    if (projectId) return c.workspaceRepo.project(projectId).path
    if (!skillPath) return undefined
    return c.projects.list().map((p) => p.path).find((root) => skillPath.startsWith(root))
  }

  /** A scope's folder (workspace, else project) and the id its events use. */
  const folderOf = (scope: { workspaceId?: string; projectId?: string }): { root: string; key: string } =>
    scope.workspaceId
      ? { root: c.workspaceRepo.get(scope.workspaceId).path, key: scope.workspaceId }
      : { root: c.workspaceRepo.project(scope.projectId!).path, key: scope.projectId! }

  const pickPath = async (sender: Electron.WebContents, options: Electron.OpenDialogOptions): Promise<string | undefined> => {
    const window = BrowserWindow.fromWebContents(sender)
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    return result.canceled ? undefined : result.filePaths[0]
  }

  return {
  'app.info': () => ({
    platform: process.platform as 'win32' | 'darwin' | 'linux',
    version: app.getVersion(),
    hooksAvailable: Boolean(c.hookServer.endpoint),
    isDev: !app.isPackaged
  }),

  'projects.list': () => c.projects.list(),
  'projects.open': async (_input, event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = { title: 'Open project', properties: ['openDirectory', 'createDirectory'] as const }
    const result = window
      ? await dialog.showOpenDialog(window, { ...options, properties: [...options.properties] })
      : await dialog.showOpenDialog({ ...options, properties: [...options.properties] })
    const folder = result.filePaths[0]
    return result.canceled || !folder ? null : c.projects.open(folder)
  },
  'projects.remove': ({ projectId }) => c.projects.remove(projectId),
  'projects.touch': ({ projectId }) => c.projects.touch(projectId),

  'workspaces.list': ({ projectId }) => c.workspaces.list(projectId),
  'workspaces.suggestName': ({ projectId }) => c.workspaces.suggestName(projectId),
  'workspaces.create': (input) => c.workspaces.create(input),
  'workspaces.delete': ({ workspaceId, force }) => c.workspaces.delete(workspaceId, force ?? false),

  'clis.list': (input) => c.registry.list(input?.refresh ?? false),

  'agents.list': ({ workspaceId }) => c.agents.list(workspaceId),
  'agents.open': ({ workspaceId, cliId, placement }) => c.agents.open(workspaceId, cliId, placement),
  'agents.close': ({ instanceId }) => c.agents.close(instanceId),
  'agents.restart': ({ instanceId }) => c.agents.restart(instanceId),
  'agents.applyPreset': ({ workspaceId, presetId }) => {
    const preset = c.presets.get(presetId)
    c.agents.applyPreset(workspaceId, preset.cliSelections, preset.autoApprove, preset.chatUi ?? false)
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
  'updates.status': () => c.updates.current(),
  'updates.check': () => c.updates.check(),
  'updates.download': () => c.updates.download(),
  'updates.install': () => c.updates.install(),

  'system.revealPath': async ({ projectId, workspaceId }) => {
    const folder = workspaceId
      ? c.workspaceRepo.get(workspaceId).path
      : projectId
        ? c.workspaceRepo.project(projectId).path
        : fail('INVALID_INPUT', 'Nothing to reveal.')
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
    return fail('INVALID_INPUT', 'Choose a project or workspace first.')
  },
  'shell.restart': ({ id }) => c.shells.restart(id),
  'shell.close': ({ id }) => c.shells.close(id),

  'extensions.scan': ({ projectId }) =>
    c.extensions.scan(projectId ? c.workspaceRepo.project(projectId).path : undefined),
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
  'extensions.importSkill': async ({ rootIds, projectId }, event) => {
    const folder = await pickPath(event.sender, { title: 'Choose a skill folder (with SKILL.md)', properties: ['openDirectory'] })
    if (!folder) return false
    c.extensions.importSkill(folder, rootIds, projectPathOf(projectId))
    return true
  },

  'system.openUrl': async ({ url }) => {
    if (!isPluginHelpUrl(url)) fail('FORBIDDEN', 'Hiveory only opens plugin help pages from here.')
    await shell.openExternal(url)
  },
  'files.list': async ({ scope, dir }) => {
    const { root } = folderOf(scope)
    return { root, entries: await c.files.list(root, dir) }
  },
  'files.search': ({ scope, query }) => c.files.search(folderOf(scope).root, query),
  'files.read': ({ scope, path }) => c.files.read(folderOf(scope).root, path),
  'files.write': ({ scope, path, content }) => c.files.write(folderOf(scope).root, path, content),
  'files.create': ({ scope, path, kind }) => c.files.create(folderOf(scope).root, path, kind),
  'files.rename': async ({ scope, from, to }) => {
    await c.files.rename(folderOf(scope).root, from, to)
    if (scope.workspaceId) c.editors.renamed(scope.workspaceId, from, to)
  },
  'files.delete': ({ scope, paths }) => c.files.remove(folderOf(scope).root, paths),
  'files.paste': ({ scope, sources, targetDir, mode }) => c.files.paste(folderOf(scope).root, sources, targetDir, mode),
  'files.reveal': ({ scope, path }) => {
    shell.showItemInFolder(c.files.resolveIn(folderOf(scope).root, path))
  },
  'files.watch': ({ scope, watch }) => {
    const { root, key } = folderOf(scope)
    c.files.watch(key, root, watch)
  },
  'editors.list': ({ workspaceId }) => c.editors.list(workspaceId),
  'editors.open': ({ workspaceId, path, targetPaneId, side }) => {
    c.files.resolveIn(c.workspaceRepo.get(workspaceId).path, path)
    return c.editors.open(workspaceId, path, targetPaneId && side ? { targetPaneId, side } : undefined)
  },
  'editors.close': ({ editorId }) => c.editors.close(editorId),
  'connections.list': () => c.connections.list(),
  'connections.requirements': () => {
    const env = processDiscoveryEnv()
    return { npx: Boolean(findExecutable('npx', env)), uvx: Boolean(findExecutable('uvx', env)) }
  },
  'connections.savePlugin': ({ pluginId, values }) => c.connections.savePlugin(pluginId, values),
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

  'browser.state': () => c.browser.state(),
  'browser.open': ({ scope, url, profileId }) => c.browser.open({ scope, url, profileId }),
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
  'browser.annotate': ({ pageId, element, note }) => c.browser.annotate(pageId, element, note),
  'browser.deleteAnnotation': ({ id }) => c.browser.deleteAnnotations(id),
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
  'chat.list': () => c.chats.list(),
  'chat.get': ({ chatId }) => ({ ...c.chats.get(chatId), running: c.chats.isRunning(chatId) }),
  'chat.create': ({ projectId }) => c.chats.create(projectId),
  'chat.update': ({ chatId, ...patch }) => c.chats.update(chatId, patch),
  'chat.delete': ({ chatId }) => c.chats.delete(chatId),
  'chat.send': ({ chatId, text, attachments }) => c.chats.send(chatId, text, attachments ?? []),
  'chat.attach': ({ chatId, name, mime, data }) => c.chats.attach(chatId, name, mime, data),
  'chat.attachPath': ({ chatId, path }) => c.chats.attachPath(chatId, path),
  'chat.stop': ({ chatId }) => c.chats.stop(chatId),
  'chat.catalog': ({ cliId, refresh }) => c.chats.catalog(cliId, refresh ?? false),

  'git.info': ({ projectId }) => c.workspaces.gitInfo(projectId),
  'git.validateBranch': async ({ projectId, name }) => {
    const project = c.workspaceRepo.project(projectId)
    const repoRoot = project.repositoryRoot ?? (await c.git.repositoryRoot(project.path))
    if (!repoRoot) return { problem: 'This project is not a Git repository.' }
    const problem = await c.git.branchNameProblem(repoRoot, name)
    if (problem) return { problem }
    return { problem: (await c.git.localBranchExists(repoRoot, name)) ? `Branch ${name} already exists.` : null }
  },
  'git.init': ({ projectId, commit }) => c.projects.initRepository(projectId, commit),
  'workspaces.gitStatus': ({ workspaceId }) => c.workspaces.gitStatus(workspaceId),
  'workspaces.repair': ({ workspaceId }) => c.workspaces.repair(workspaceId),
  'github.status': async ({ projectId }) => {
    const root = await repoRootOf(projectId)
    return root ? c.github.status(root) : { available: false, reason: 'This project is not a Git repository.' }
  },
  'github.pullRequests': async ({ projectId }) => c.github.pullRequests(await requireRepoRoot(projectId)),
  'github.issues': async ({ projectId }) => c.github.issues(await requireRepoRoot(projectId)),
  'github.createPullRequest': async ({ workspaceId, draft }) => {
    const workspace = c.workspaceRepo.get(workspaceId)
    const branch = workspace.git?.branch
    if (workspace.kind !== 'isolated' || !branch || !workspace.git?.worktreePath) {
      return fail('INVALID_INPUT', 'Pull requests are created from an isolated workspace branch.')
    }
    const root = await requireRepoRoot(workspace.projectId)
    return { url: await c.github.createPullRequest(root, workspace.git.worktreePath, branch, draft ?? false) }
  },

  'kanban.board': ({ projectId }) =>
    buildBoard(
      projectId,
      // Shells are terminals, not agents: they have no place on the board.
      c.agents.instancesInProject(projectId).filter((i) => c.registry.adapter(i.cliId)?.kind !== 'shell'),
      (workspaceId) => c.workspaceRepo.find(workspaceId)?.name,
      (instanceId) => c.runtime.details(instanceId)
    )
}
}
