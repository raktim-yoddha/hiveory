import type { Channel } from './contract'

/**
 * Hiveory server and desktop client (ADR 0022). A paired client may call only
 * these channels on a server, which validates them with the same schemas as
 * local IPC. Everything that needs the server's own screen, dialogs, clipboard,
 * microphone or installer stays out — default deny: a new channel is not
 * remote until it is added here on purpose.
 */
export const REMOTE_CHANNELS = new Set<Channel>([
  'projects.list', 'projects.add', 'projects.addDefaults', 'projects.previous', 'projects.restore', 'projects.remove', 'projects.touch',
  'workspaces.list', 'workspaces.suggestName', 'workspaces.create', 'workspaces.delete', 'workspaces.gitStatus', 'workspaces.repair',
  'clis.list', 'agents.list', 'agents.open', 'agents.close', 'agents.restart', 'agents.applyPreset', 'agents.sendMessage', 'agents.interrupt',
  'sessions.list', 'terminal.write', 'terminal.resize', 'terminal.snapshot',
  'layout.get', 'layout.apply', 'presets.list', 'presets.save', 'presets.delete', 'kanban.board',
  'queen.plan', 'queen.peek', 'queen.accounts', 'queen.saveAccount', 'queen.removeAccount', 'queen.moveAccount', 'queen.testAccount', 'queen.listModels',
  'settings.get', 'settings.update', 'shell.open', 'shell.restart', 'shell.close', 'extensions.scan',
  'files.list', 'files.search', 'files.read', 'files.write', 'files.create', 'files.rename', 'files.delete', 'files.paste', 'files.watch',
  'editors.list', 'editors.open', 'editors.close',
  'connections.list', 'apps.status', 'apps.setKey', 'apps.removeKey', 'apps.connect', 'apps.disconnect', 'connections.saveCustom', 'connections.import', 'connections.setEnabled', 'connections.test', 'connections.remove',
  'chat.clis', 'chat.list', 'chat.get', 'chat.create', 'chat.update', 'chat.delete', 'chat.send', 'chat.attach', 'chat.stop', 'chat.catalog',
  'bots.list', 'bots.create', 'bots.update', 'bots.delete', 'bots.threads', 'bots.newThread', 'bots.computer',
  'hosts.check', 'hosts.listDir', 'git.info', 'git.validateBranch', 'git.init',
  'github.status', 'github.pullRequests', 'github.issues', 'github.createPullRequest'
])

/**
 * Answered by the client's own machine even while it is connected to a server: its clipboard,
 * links, switching servers, and neutral answers for the window's start-up reads of things a
 * client does not have (updates, voice packs, built-in browser pages, wallpapers).
 */
export const CLIENT_LOCAL_CHANNELS = new Set<Channel>([
  'app.info', 'clipboard.readText', 'clipboard.writeText', 'system.openUrl', 'client.status', 'client.connect', 'client.disconnect',
  'updates.status', 'voice.status', 'browser.state', 'wallpapers.list'
])

/** The server's wire format: a call, and one event on the event stream. */
export interface ServerCall {
  channel: Channel
  payload: unknown
}
export interface ServerEvent {
  event: string
  payload: unknown
}

/** One pairing code per server start (or `--pair`): short, single use, expires. */
export const PAIRING_CODE = /^[A-Z0-9]{8}$/
export const PAIRING_TTL_MS = 15 * 60_000
