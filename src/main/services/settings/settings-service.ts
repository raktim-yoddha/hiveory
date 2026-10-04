import { EventEmitter } from 'node:events'
import type { AppSettings } from '@shared/domain'
import type { Emit } from '../events'
import type { StateStore } from '../persistence/state-store'

/** App preferences. Other services subscribe to `changed` to react (theme → window chrome, updates → schedule). */
export class SettingsService extends EventEmitter<{ changed: [settings: AppSettings, previous: AppSettings] }> {
  constructor(
    private readonly store: StateStore,
    private readonly broadcast: Emit
  ) {
    super()
  }

  get(): AppSettings {
    return { ...this.store.state.settings }
  }

  update(patch: Partial<AppSettings>): AppSettings {
    const previous = this.get()
    this.store.update((s) => {
      s.settings = { ...s.settings, ...patch }
    })
    const next = this.get()
    this.broadcast('state.changed', { topic: 'settings' })
    this.emit('changed', next, previous)
    return next
  }
}
