import type { Channel, EventMap, RequestOf, ResponseOf } from '@shared/ipc/contract'

/**
 * Every call the phone makes (ADR 0027). Each must be in the computer's
 * MOBILE_CHANNELS, which it enforces; a test keeps the two lists in step, so a
 * channel the computer would refuse cannot be called from here.
 */
export const PHONE_CHANNELS = [
  'projects.list',
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
  'hosts.status',
  'ssh.pending',
  'ssh.answer'
] as const satisfies readonly Channel[]

export type PhoneChannel = (typeof PHONE_CHANNELS)[number]
export type Request<C extends PhoneChannel> = RequestOf<C>
export type Response<C extends PhoneChannel> = ResponseOf<C>
/** Arguments after the channel: none when the channel takes no payload. */
export type PayloadArgs<C extends PhoneChannel> = undefined extends Request<C> ? [Request<C>?] : [Request<C>]

export type ServerEventName = keyof EventMap
export type ServerEvent<E extends ServerEventName = ServerEventName> = { event: E; payload: EventMap[E] }
