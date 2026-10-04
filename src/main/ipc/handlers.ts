import { app, BrowserWindow, dialog } from 'electron'
import type { Container } from '../app/container'
import { buildBoard } from '../services/kanban/build-board'
import type { Handlers } from './router'

/** Maps each contract channel onto an application service. No logic lives here. */
export const createHandlers = (c: Container): Handlers => ({
  'app.info': () => ({
    platform: process.platform as 'win32' | 'darwin' | 'linux',
    version: app.getVersion(),
    hooksAvailable: Boolean(c.hookServer.endpoint)
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
    c.agents.applyPreset(workspaceId, preset.cliSelections, preset.autoApprove)
  },

  'terminal.write': ({ instanceId, data }) => c.runtime.write(instanceId, data),
  'terminal.resize': ({ instanceId, cols, rows }) => c.runtime.resize(instanceId, cols, rows),
  'terminal.snapshot': ({ instanceId }) => c.runtime.snapshot(instanceId),

  'layout.get': ({ workspaceId }) => c.layouts.get(workspaceId, c.agents.paneIds(workspaceId)),
  'layout.apply': ({ workspaceId, operation }) =>
    c.layouts.apply(workspaceId, c.agents.paneIds(workspaceId), operation),

  'presets.list': () => c.presets.list(),
  'presets.save': (input) => c.presets.save(input),
  'presets.delete': ({ presetId }) => c.presets.delete(presetId),

  'kanban.board': ({ projectId }) =>
    buildBoard(
      projectId,
      c.agents.instancesInProject(projectId),
      (workspaceId) => c.workspaceRepo.find(workspaceId)?.name,
      (instanceId) => c.runtime.details(instanceId)
    )
})
