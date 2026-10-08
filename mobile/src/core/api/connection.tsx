import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AppState } from 'react-native'
import { useQueryClient } from '@tanstack/react-query'
import { useActiveComputer } from '../computers/store'
import type { Computer } from './client'
import type { ServerEvent, ServerEventName } from './contract'
import { createEmitter, type Emitter } from './emitter'
import { openStream, type Stream, type StreamStatus } from './events'
import { staleChannels } from './invalidation'

/** Coalesces bursts (five agents changing status at once) into one refetch per channel. */
const REFETCH_DELAY_MS = 250

interface ConnectionValue {
  computer: Computer | null
  token: string | null
  status: StreamStatus
  emitter: Emitter
  retry(): void
}

const ConnectionContext = createContext<ConnectionValue | null>(null)

/**
 * The live link to the active computer: one event stream (everything but
 * terminal output), the cache kept fresh from it, and a fresh start whenever
 * the app comes back to the foreground.
 */
export function ConnectionProvider({ children }: { children: ReactNode }) {
  const active = useActiveComputer()
  const queryClient = useQueryClient()
  const emitter = useMemo(() => createEmitter(), [])
  const [status, setStatus] = useState<StreamStatus>('connecting')
  const stream = useRef<Stream | null>(null)
  const computerId = active?.computer.id
  const token = active?.token

  useEffect(() => {
    if (!active) return
    const pending = new Set<PhoneChannelName>()
    let timer: ReturnType<typeof setTimeout> | null = null
    const onEvent = (event: ServerEvent): void => {
      emitter.emit(event)
      for (const channel of staleChannels(event)) pending.add(channel)
      if (!pending.size || timer) return
      timer = setTimeout(() => {
        timer = null
        const channels = new Set(pending)
        pending.clear()
        void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === active.computer.id && channels.has(q.queryKey[1] as PhoneChannelName) })
      }, REFETCH_DELAY_MS)
    }
    stream.current = openStream(active.computer, active.token, 'none', onEvent, (next) => {
      setStatus(next)
      // Back online: anything may have changed meanwhile.
      if (next === 'online') void queryClient.invalidateQueries({ queryKey: [active.computer.id] })
    })
    return () => {
      if (timer) clearTimeout(timer)
      stream.current?.close()
      stream.current = null
    }
    // The stream follows the computer and its token, not every render's object identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computerId, token, emitter, queryClient])

  useEffect(() => {
    // Only a real return from the background starts fresh. "active" also follows Control Center,
    // permission and Face ID prompts (and focus changes on web), where the stream is still alive.
    let previous = AppState.currentState
    const sub = AppState.addEventListener('change', (state) => {
      if (previous === 'background' && state === 'active') stream.current?.retry()
      previous = state
    })
    return () => sub.remove()
  }, [])

  const value = useMemo<ConnectionValue>(
    () => ({ computer: active?.computer ?? null, token: active?.token ?? null, status, emitter, retry: () => stream.current?.retry() }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [computerId, token, status, emitter]
  )
  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>
}

type PhoneChannelName = ReturnType<typeof staleChannels>[number]

export const useConnection = (): ConnectionValue => {
  const value = useContext(ConnectionContext)
  if (!value) throw new Error('useConnection needs ConnectionProvider')
  return value
}

/** Runs `listener` for each live event of that kind from the active computer. */
export const useServerEvent = <E extends ServerEventName>(name: E, listener: (payload: ServerEvent<E>['payload']) => void): void => {
  const { emitter } = useConnection()
  const latest = useRef(listener)
  // The newest listener, without resubscribing on every render.
  useEffect(() => {
    latest.current = listener
  })
  useEffect(() => emitter.on(name, (payload) => latest.current(payload)), [emitter, name])
}
