import type { ServerEvent, ServerEventName } from './contract'

type Listener = (event: ServerEvent) => void

/** Fans the computer's live events out to whoever listens; one throwing listener never stops the others. */
export const createEmitter = () => {
  const listeners = new Set<Listener>()
  return {
    on<E extends ServerEventName>(name: E, listener: (payload: ServerEvent<E>['payload']) => void): () => void {
      const wrapped: Listener = (e) => {
        if (e.event === name) listener(e.payload as ServerEvent<E>['payload'])
      }
      listeners.add(wrapped)
      return () => void listeners.delete(wrapped)
    },
    emit(event: ServerEvent): void {
      for (const l of listeners) {
        try {
          l(event)
        } catch (error) {
          console.warn('A live-update listener failed', error)
        }
      }
    }
  }
}

export type Emitter = ReturnType<typeof createEmitter>
