import { create } from 'zustand'
import type { Trigger, TriggerLinkStatus, TriggerType } from '@shared/domain/trigger'
import type { RequestOf } from '@shared/ipc/contract'
import { api } from '../lib/api'
import { reportError, runAction } from './notices'

type TriggerInput = RequestOf<'triggers.create'>

interface TriggersState {
  link: TriggerLinkStatus
  triggers: Trigger[]
  /** Each app's events, fetched once per app. */
  types: Record<string, TriggerType[]>
  loaded: boolean
  load(): Promise<void>
  loadTypes(appId: string): Promise<void>
  enableLink(takeOver?: boolean): Promise<void>
  disableLink(): Promise<void>
  create(input: TriggerInput): Promise<Trigger | undefined>
  update(triggerId: string, patch: Omit<RequestOf<'triggers.update'>, 'triggerId'>): Promise<void>
  remove(triggerId: string): Promise<void>
}

/** Triggers and their public link (ADR 0028). Main owns them; this mirrors them for the Triggers page. */
export const useTriggers = create<TriggersState>((set, get) => ({
  link: { state: 'off' },
  triggers: [],
  types: {},
  loaded: false,

  load: async () => {
    try {
      const [link, triggers] = await Promise.all([api('triggers.status'), api('triggers.list')])
      set({ link, triggers, loaded: true })
    } catch (error) {
      set({ loaded: true })
      reportError(error, 'Load triggers')
    }
  },

  loadTypes: async (appId) => {
    if (get().types[appId]) return
    const types = await runAction('Load events', () => api('triggers.types', { appId }))
    if (types) set((s) => ({ types: { ...s.types, [appId]: types } }))
  },

  enableLink: async (takeOver) => {
    const link = await runAction('Turn on the event link', () => api('triggers.enableLink', { takeOver }))
    if (link) set({ link })
  },

  disableLink: async () => {
    const link = await runAction('Turn off the event link', () => api('triggers.disableLink'))
    if (link) set({ link })
  },

  create: async (input) => {
    const trigger = await runAction('Create trigger', () => api('triggers.create', input))
    await get().load()
    return trigger
  },

  update: async (triggerId, patch) => {
    await runAction('Update trigger', () => api('triggers.update', { triggerId, ...patch }))
    await get().load()
  },

  remove: async (triggerId) => {
    await runAction('Delete trigger', () => api('triggers.delete', { triggerId }))
    await get().load()
  }
}))
