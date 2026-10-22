import type { Channel } from './contract'

/**
 * Hiveory server and desktop client (ADR 0022). A paired client may call only
 * these channels on a server, which validates them with the same schemas as
 * local IPC. Everything that needs the server's own screen, dialogs, clipboard,
 * microphone or installer stays out — default deny: a new channel is not
 * remote until it is added here on purpose.
 */
export const REMOTE_CHANNELS = new Set<Channel>([
  'projects.list', 'projects.add', 'projects.addDefaults', 'projects.remove', 'projects.touch', 'projects.update',
  'workspaces.list', 'workspaces.suggestName', 'workspaces.create', 'workspaces.delete', 'workspaces.gitStatus', 'workspaces.repair',
  'clis.list', 'agents.list', 'agents.open', 'agents.close', 'agents.rename', 'agents.restart', 'agents.applyPreset', 'agents.sendMessage', 'agents.interrupt',
  'sessions.list', 'terminal.write', 'terminal.resize', 'terminal.snapshot', 'terminalHost.status', 'terminalHost.restart',
  'layout.get', 'layout.apply', 'presets.list', 'presets.save', 'presets.delete', 'kanban.board',
  'queen.plan', 'queen.peek', 'queen.accounts', 'queen.saveAccount', 'queen.removeAccount', 'queen.moveAccount', 'queen.testAccount', 'queen.listModels',
  'settings.get', 'settings.update', 'shell.open', 'shell.restart', 'shell.close', 'extensions.scan',
  'files.list', 'files.search', 'files.read', 'files.write', 'files.create', 'files.rename', 'files.delete', 'files.paste', 'files.watch',
  'editors.list', 'editors.open', 'editors.close',
  'connections.list', 'apps.status', 'apps.setKey', 'apps.removeKey', 'apps.connect', 'apps.disconnect', 'connections.saveCustom', 'connections.import', 'connections.setEnabled', 'connections.test', 'connections.remove',
  'chat.clis', 'chat.list', 'chat.get', 'chat.create', 'chat.update', 'chat.setModel', 'chat.delete', 'chat.send', 'chat.attach', 'chat.stop', 'chat.catalog', 'chat.queue', 'chat.unqueue', 'prompts.list', 'prompts.save', 'prompts.delete',
  'bots.list', 'bots.create', 'bots.update', 'bots.delete', 'bots.threads', 'bots.newThread', 'bots.computer', 'bots.screen',
  'teams.list', 'teams.create', 'teams.rename', 'teams.delete', 'bots.handoffs', 'bots.preview',
  'approvals.list', 'approvals.answer',
  'triggers.status', 'triggers.list', 'triggers.types', 'triggers.create', 'triggers.update', 'triggers.delete',
  'routines.list', 'routines.addFile', 'routines.create', 'routines.update', 'routines.delete', 'routines.runNow', 'routines.runs',
  'hosts.check', 'hosts.suggest', 'hosts.status', 'hosts.listDir', 'ssh.pending', 'ssh.answer', 'git.info', 'git.validateBranch', 'git.init',
  'github.status', 'github.pullRequests', 'github.issues', 'github.createPullRequest',
  'store.searchSkills', 'store.topSkills', 'store.skillAudits', 'store.installSkill', 'store.searchMcp',
  'integrations.status', 'integrations.connectJira', 'integrations.connectLinear', 'integrations.disconnect', 'integrations.groups', 'issues.list',
  // Everything a mode needs that runs on the server itself, not this window (ADR 0052): stop a Queen Bee
  // plan, write and remove skills, and the Trigger link.
  'queen.cancelPlan', 'extensions.createSkill', 'extensions.removeSkill', 'extensions.copySkill', 'triggers.enableLink', 'triggers.disableLink'
])

/**
 * Answered by the client's own machine even while it is connected to a server: its clipboard,
 * links, switching servers, and neutral answers for the window's start-up reads of things a
 * client does not have (updates, voice packs, built-in browser pages, wallpapers).
 */
export const CLIENT_LOCAL_CHANNELS = new Set<Channel>([
  'app.info', 'clipboard.readText', 'clipboard.writeText', 'system.openUrl', 'client.status', 'client.connect', 'client.disconnect', 'client.discover',
  'updates.status', 'voice.status', 'browser.state', 'wallpapers.list', 'themes.installed'
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

/** Where a shared desktop listens, and where discovery looks for servers on the tailnet (ADR 0025). */
export const DEFAULT_SERVER_PORT = 7788

/**
 * What a paired phone may do (ADR 0027, widened by ADR 0053): the three modes as on a paired
 * desktop — agents, terminals, files, worktrees, presets, bots, teams, Schedules, triggers, chats,
 * attachments and saved prompts. App settings, accounts and keys, and what needs the computer's
 * own screen (folder pickers, pane layout, the browser) stay on the desktop. A terminal is sized
 * to the phone only while the phone's stream of it is open, never through a call (ADR 0048).
 * A subset of REMOTE_CHANNELS (a test checks).
 */
export const MOBILE_CHANNELS = new Set<Channel>([
  'projects.list', 'projects.update', 'github.status', 'github.pullRequests', 'github.createPullRequest', 'workspaces.list', 'workspaces.create', 'workspaces.suggestName', 'workspaces.gitStatus',
  'clis.list', 'agents.list', 'agents.open', 'agents.close', 'agents.restart', 'agents.applyPreset', 'agents.sendMessage', 'agents.interrupt',
  'terminal.write', 'terminal.snapshot', 'presets.list', 'kanban.board', 'settings.get', 'sessions.list',
  'chat.clis', 'chat.list', 'chat.get', 'chat.create', 'chat.send', 'chat.stop', 'chat.catalog', 'chat.setModel',
  // The phone's Bots tab (ADR 0039): see bots, read and continue their threads, start one.
  'bots.list', 'bots.threads', 'bots.newThread',
  // Answer a bot's approval requests, and follow and run Schedules (ADR 0052).
  'approvals.list', 'approvals.answer', 'routines.list', 'routines.runNow',
  'hosts.status', 'ssh.pending', 'ssh.answer', 'git.info',
  // The phone matches the desktop in every mode (ADR 0053).
  'projects.add', 'projects.remove', 'workspaces.delete', 'workspaces.repair', 'git.init', 'agents.rename', 'presets.save', 'presets.delete', 'files.list', 'files.search', 'files.read', 'files.write', 'files.create', 'files.rename', 'files.delete', 'github.issues',
  'bots.create', 'bots.update', 'bots.delete', 'teams.list', 'teams.create', 'teams.rename', 'teams.delete', 'triggers.status', 'triggers.list', 'triggers.update', 'triggers.delete', 'triggers.enableLink', 'triggers.disableLink', 'routines.create', 'routines.update', 'routines.delete', 'routines.runs',
  'chat.update', 'chat.delete', 'chat.attach', 'chat.queue', 'chat.unqueue', 'prompts.list', 'prompts.save', 'prompts.delete'
])

/** Who a paired device is: a desktop window (everything remote) or a phone (MOBILE_CHANNELS). */
export type DeviceScope = 'desktop' | 'mobile'
