import type { Result } from '../shared/errors'
import type { Channel, EventMap, EventName, RequestOf, ResponseOf } from '../shared/ipc/contract'

export interface HiveoryApi {
  invoke<C extends Channel>(
    channel: C,
    ...payload: undefined extends RequestOf<C> ? [RequestOf<C>?] : [RequestOf<C>]
  ): Promise<Result<ResponseOf<C>>>
  on<E extends EventName>(event: E, listener: (payload: EventMap[E]) => void): () => void
}

declare global {
  interface Window {
    hiveory: HiveoryApi
  }
}
