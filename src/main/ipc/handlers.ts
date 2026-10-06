import { BrowserWindow, app, clipboard, dialog, safeStorage, shell, systemPreferences } from 'electron'
import { connectAndSave } from '../app/client'
import { relaunch } from '../app/client-mode'
import { HOST_PROTOCOL } from '@shared/host/protocol'
import { isAppsHelpUrl } from '@shared/domain'
import { fail } from '@shared/errors'
import type { Container } from '../app/container'
import { WALLPAPER_EXTENSIONS } from '../services/appearance/wallpaper-service'
import { buildBoard } from '../services/kanban/build-board'
import type { Handlers } from './router'
import { deliverMessage } from '../services/agent-tools/deliver'
import { voiceFor } from '@shared/queen/voice'
import { personaInfo } from '@shared/queen/personas'
import { lastWords } from '@shared/queen/updates'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { PreviousProject, Project } from '@shared/domain'
import { samePath } from '../services/projects/project-service'

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
    if (c.workspaceRepo.project(projectId).host) fail('INVALID_INPUT', `${what} works for projects on this computer.`, { hint: 'Use gh in a terminal on that machine.' })
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
  /** Opens (or restores) a project, then brings back any of its workspaces found on disk. */
  const addProject = async (path: string, name?: string): Promise<Project> => {
    const project = await c.projects.open(path, name)
    const adopted = await c.workspaces.adoptWorktrees(project.id).catch(() => 0)
    if (adopted) c.log.info(`Restored ${adopted} workspace folder(s) for ${project.name}`)
    return project
  }

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
    return result.canceled || !folder ? null : addProject(folder)
  },
  'projects.pickFolder': async ({ purpose }, event) => {
    const folder = await pickPath(event.sender, {
      title: purpose === 'project' ? 'Choose the project folder' : 'Choose where it goes',
      properties: ['openDirectory', 'createDirectory']
    })
    if (folder) picked.add(folder)
    return folder ?? null
  },
  'projects.addDefaults': async () => ({ parentDir: defaultParent(), github: await c.repositories.githubAccount() }),
  'projects.add': async (input) => {
    if (input.mode === 'remote') {
      return c.projects.openRemote({ kind: 'ssh', destination: input.destination, ...(input.port ? { port: input.port } : {}) }, input.path, input.name)
    }
    if (input.mode === 'folder') return addProject(chosen(input.path), input.name)
    if (input.mode === 'clone') return addProject(await c.repositories.clone(input.url, chosen(input.parentDir)), input.name)
    const created = await c.repositories.create(input.repoName, chosen(input.parentDir), input.github)
    const project = await addProject(created.path, input.name)
    if (created.warning) c.emit('app.notice', { level: 'warning', message: created.warning })
    return project
  },
  'projects.previous': () => {
    const open = c.projects.list()
    const openAt = (path: string) => open.find((p) => samePath(p.repositoryRoot ?? p.path, path) || samePath(p.path, path))?.id
    const removed: PreviousProject[] = c.projects.archived().map((a) => ({
      source: 'removed',
      name: a.project.name,
      path: a.project.path,
      workspaces: a.workspaces.map((w) => w.name),
      agents: a.instances.length,
      removedAt: a.removedAt,
      missing: !existsSync(a.project.path)
    }))
    const found: PreviousProject[] = c.workspaces
      .foundWorktrees()
      .filter((f) => !removed.some((r) => samePath(r.path, f.repoRoot)))
      .map((f) => ({ source: 'found', name: f.name, path: f.repoRoot, workspaces: f.workspaces, agents: 0, missing: false, projectId: openAt(f.repoRoot) }))
    return [...removed, ...found]
  },
  'projects.restore': async ({ path }) => {
    // Only something "Restore previous" listed.
    const known = c.projects.archived().some((a) => samePath(a.project.path, path)) || c.workspaces.foundWorktrees().some((f) => samePath(f.repoRoot, path))
    if (!known) fail('NOT_FOUND', 'There is nothing to restore there any more.')
    const open = c.projects.list().find((p) => samePath(p.repositoryRoot ?? p.path, path) || samePath(p.path, path))
    if (!open) return addProject(path)
    await c.workspaces.adoptWorktrees(open.id)
    return open
  },
  'projects.remove': ({ projectId }) => c.projects.remove(projectId),
  'projects.touch': ({ projectId }) => c.projects.touch(projectId),

  'workspaces.list': ({ projectId }) => c.workspaces.list(projectId),
  'workspaces.suggestName': ({ projectId }) => c.workspaces.suggestName(projectId),
  'workspaces.create': async (input) => {
    const workspace = await c.workspaces.create(input)
    c.projects.markActive(workspace.projectId)
    return workspace
  },
  'workspaces.delete': ({ workspaceId, force }) => c.workspaces.delete(workspaceId, force ?? false),

  'clis.list': async (input) => {
    const host = input?.projectId ? c.workspaceRepo.project(input.projectId).host : undefined
    return host ? (await c.hosts.kit(host)).registry.list(input?.refresh ?? false) : c.registry.list(input?.refresh ?? false)
  },

  'agents.list': ({ workspaceId }) => c.agents.list(workspaceId),
  'agents.open': async ({ workspaceId, cliId, placement, resumeSession }) => {
    const opened = await c.agents.open(workspaceId, cliId, placement, resumeSession)
    c.projects.markActive(opened.agent.projectId)
    return opened
  },
  'sessions.list': ({ scope, workspaceId, projectId }) => {
    if (scope === 'all') return c.sessions.list()
    if (scope === 'workspace') return c.sessions.list(workspaceId ? [c.workspaceRepo.get(workspaceId).path] : [])
    if (!projectId) return []
    const project = c.workspaceRepo.project(projectId)
    const main = c.workspaceRepo.main(project)
    return c.sessions.list([project.path, ...(main ? [main.path] : []), ...c.workspaceRepo.isolated(projectId).map((w) => w.path)])
  },
  'agents.close': ({ instanceId }) => c.agents.close(instanceId),
  'agents.restart': ({ instanceId }) => c.agents.restart(instanceId),
  'agents.sendMessage': ({ instanceId, message }) => {
    const agent = c.agents.find(instanceId) ?? fail('NOT_FOUND', 'That agent is no longer open.')
    return deliverMessage({ agents: c.agents, runtime: c.runtime, chats: c.chats }, agent, message).catch((error: unknown) =>
      fail('INVALID_INPUT', error instanceof Error ? error.message : String(error))
    )
  },
  'queen.accounts': () => c.queenBrain.accounts(),
  'queen.saveAccount': (input) => c.queenBrain.save(input),
  'queen.removeAccount': ({ id }) => c.queenBrain.remove(id),
  'queen.moveAccount': ({ id, to }) => c.queenBrain.move(id, to),
  'queen.testAccount': ({ id }) => c.queenBrain.test(id),
  'queen.listModels': (input) => c.queenBrain.listModels(input),
  'voice.status': () => c.voice.status(),
  'voice.download': ({ pack }) => c.voice.download(pack),
  'voice.cancel': ({ pack }) => c.voice.cancel(pack),
  'voice.remove': ({ pack }) => c.voice.remove(pack),
  'voice.transcribe': ({ samples, language }) => c.voice.transcribe(samples, language),
  'voice.speak': ({ text, sid }) => {
    const s = c.settings.get()
    return c.voice.speak(text, sid ?? voiceFor(s).sid, s.queenVoiceSpeed)
  },
  'voice.micAccess': async () => {
    if (process.platform === 'darwin') return systemPreferences.askForMediaAccess('microphone')
    if (process.platform === 'win32') return systemPreferences.getMediaAccessStatus('microphone') !== 'denied'
    return true
  },
  'queen.plan': ({ utterance, context }) => {
    const s = c.settings.get()
    return c.queenBrain.plan(utterance, context, personaInfo(s), s.queenMemory)
  },
  'agents.interrupt': ({ instanceId }) => c.agents.interrupt(instanceId),
  'queen.peek': ({ instanceId }) => {
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
  'queen.hotkeyStatus': () => c.hotkey.current(),
  'queen.hotkeyAccess': () => {
    const s = c.settings.get()
    return c.hotkey.requestAccess(s.queenGlobalShortcut, s.queenShortcut)
  },
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
    if (!isAppsHelpUrl(url)) fail('FORBIDDEN', 'Hiveory only opens the Composio account page from here.')
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
  'bots.list': () => c.bots.list(),
  'bots.create': (input) => c.bots.create(input),
  'bots.update': ({ botId, ...patch }) => c.bots.update(botId, patch),
  'bots.delete': ({ botId }) => c.bots.delete(botId),
  'bots.threads': ({ botId }) => {
    c.bots.get(botId)
    return c.chats.threads(botId)
  },
  'bots.newThread': ({ botId }) => c.bots.newThread(botId),
  // This window runs its own services; connecting pairs with a server and relaunches as its client (ADR 0022).
  'client.status': () => ({ mode: 'local' as const, connected: false }),
  'client.connect': async (input) => {
    const server = await connectAndSave(input, c.sshHosts, c.paths.clientFile, safeStorage)
    relaunch()
    return { mode: 'client' as const, server, connected: true }
  },
  'client.disconnect': () => undefined,
  'bots.computer': async ({ botId, action }) => {
    if (action === 'start') await c.computers.ensure(botId)
    if (action === 'stop') await c.computers.stop(botId)
    if (action === 'takeControl') {
      // A loopback noVNC address Hiveory built itself (never a URL from the bot).
      const url = await c.computers.takeControl(botId)
      await shell.openExternal(url)
      return { ...(await c.computers.status(botId)), url }
    }
    return c.computers.status(botId)
  },
  'hosts.listDir': async ({ destination, port, path }) => {
    const kit = await c.hosts.kit({ kind: 'ssh', destination, ...(port ? { port } : {}) })
    const dir = !path || path === '~' ? kit.home : path.startsWith('~/') ? kit.paths.join(kit.home, path.slice(2)) : path
    const entries = await kit.fs.readDir(dir)
    return { path: dir, home: kit.home, dirs: entries.filter((e) => e.dir && !e.name.startsWith('.')).map((e) => e.name).sort((a, b) => a.localeCompare(b)) }
  },
  'hosts.check': async (target) => {
    const info = await c.sshHosts.probe(target)
    const installed = await c.sshHosts.deploy(target)
    const { client } = await c.sshHosts.connect(target)
    try {
      const hello = await client.call('hello', { protocol: HOST_PROTOCOL })
      return { platform: info.platform, arch: info.arch, node: info.node, installed, protocol: hello.protocol }
    } finally {
      client.close()
    }
  },

  'git.info': ({ projectId }) => c.workspaces.gitInfo(projectId),
  'git.validateBranch': async ({ projectId, name }) => {
    const project = c.workspaceRepo.project(projectId)
    const kit = await c.hosts.kit(project.host)
    const repoRoot = project.repositoryRoot ?? (await kit.git.repositoryRoot(project.path))
    if (!repoRoot) return { problem: 'This project is not a Git repository.' }
    const problem = await kit.git.branchNameProblem(repoRoot, name)
    if (problem) return { problem }
    return { problem: (await kit.git.localBranchExists(repoRoot, name)) ? `Branch ${name} already exists.` : null }
  },
  'git.init': ({ projectId, commit }) => c.projects.initRepository(projectId, commit),
  'workspaces.gitStatus': ({ workspaceId }) => c.workspaces.gitStatus(workspaceId),
  'workspaces.repair': ({ workspaceId }) => c.workspaces.repair(workspaceId),
  'github.status': async ({ projectId }) => {
    if (c.workspaceRepo.project(projectId).host) return { available: false, reason: 'GitHub features work for projects on this computer.' }
    const root = await repoRootOf(projectId)
    return root ? c.github.status(root) : { available: false, reason: 'This project is not a Git repository.' }
  },
  'github.pullRequests': async ({ projectId }) => {
    localOnly(projectId, 'Pull requests')
    return c.github.pullRequests(await requireRepoRoot(projectId))
  },
  'github.issues': async ({ projectId }) => {
    localOnly(projectId, 'Issues')
    return c.github.issues(await requireRepoRoot(projectId))
  },
  'github.createPullRequest': async ({ workspaceId, draft }) => {
    const workspace = c.workspaceRepo.get(workspaceId)
    localOnly(workspace.projectId, 'Pull requests')
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
