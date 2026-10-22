import type { Channel, EventMap, RequestOf, ResponseOf } from '@shared/ipc/contract'

/**
 * Every call the phone makes (ADR 0027). Each must be in the computer's
 * MOBILE_CHANNELS, which it enforces; a test keeps the two lists in step, so a
 * channel the computer would refuse cannot be called from here.
 */
export const PHONE_CHANNELS = [
  'projects.list',
  'projects.update',
  'git.info',
  'github.status',
  'github.pullRequests',
  'github.createPullRequest',
  'workspaces.gitStatus',
  'chat.clis',
  'workspaces.list',
  'workspaces.create',
  'workspaces.suggestName',
  'clis.list',
  'agents.list',
  'agents.open',
  'agents.close',
  'agents.restart',
  'agents.applyPreset',
  'agents.sendMessage',
  'agents.interrupt',
  'terminal.write',
  'terminal.snapshot',
  'presets.list',
  'kanban.board',
  'settings.get',
  'chat.get',
  'chat.catalog',
  'chat.setModel',
  'chat.list',
  'chat.create',
  'chat.send',
  'chat.stop',
  'bots.list',
  'bots.threads',
  'bots.newThread',
  // Bot approvals and Schedules (ADR 0052).
  'approvals.list',
  'approvals.answer',
  'routines.list',
  'routines.runNow',
  'hosts.status',
  'ssh.pending',
  'ssh.answer',
  // Every mode, as on the desktop (ADR 0053).
  'projects.add',
  'projects.remove',
  'workspaces.delete',
  'workspaces.repair',
  'git.init',
  'agents.rename',
  'presets.save',
  'presets.delete',
  'files.list',
  'files.search',
  'files.read',
  'files.write',
  'files.create',
  'files.rename',
  'files.delete',
  'github.issues',
  'bots.create',
  'bots.update',
  'bots.delete',
  'teams.list',
  'teams.create',
  'teams.rename',
  'teams.delete',
  'triggers.status',
  'triggers.list',
  'triggers.update',
  'triggers.delete',
  'triggers.enableLink',
  'triggers.disableLink',
  'routines.create',
  'routines.update',
  'routines.delete',
  'routines.runs',
  'chat.update',
  'chat.delete',
  'chat.attach',
  'chat.queue',
  'chat.unqueue',
  'prompts.list',
  'prompts.save',
  'prompts.delete'
] as const satisfies readonly Channel[]

export type PhoneChannel = (typeof PHONE_CHANNELS)[number]
export type Request<C extends PhoneChannel> = RequestOf<C>
export type Response<C extends PhoneChannel> = ResponseOf<C>
/** Arguments after the channel: none when the channel takes no payload. */
export type PayloadArgs<C extends PhoneChannel> = undefined extends Request<C> ? [Request<C>?] : [Request<C>]

export type ServerEventName = keyof EventMap
export type ServerEvent<E extends ServerEventName = ServerEventName> = { event: E; payload: EventMap[E] }
