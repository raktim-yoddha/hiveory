import { useMemo } from 'react'
import { QueryClient, useMutation, useQueries, useQuery, type UseQueryOptions } from '@tanstack/react-query'
import * as Haptics from 'expo-haptics'
import { reportError } from '../notices'
import { call } from './client'
import { useConnection } from './connection'
import type { PayloadArgs, PhoneChannel, Request, Response } from './contract'

export const createQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        // Live events mark data stale; this only bounds how old a screen can look after a missed one.
        staleTime: 30_000,
        retry: 1,
        refetchOnWindowFocus: false
      }
    }
  })

/**
 * Reads from the active computer, cached per computer, channel and payload,
 * and refreshed by the computer's own live events (see invalidation.ts).
 */
export const useCall = <C extends PhoneChannel>(
  channel: C,
  payload: Request<C>,
  options: Omit<UseQueryOptions<Response<C>>, 'queryKey' | 'queryFn'> = {}
) => {
  const { computer, token } = useConnection()
  return useQuery<Response<C>>({
    queryKey: [computer?.id, channel, payload],
    queryFn: () => call(computer!, token!, channel, ...([payload] as PayloadArgs<C>)),
    enabled: Boolean(computer && token) && (options.enabled ?? true),
    ...options
  })
}

/** Does something on the active computer; failures show as a notice, successes tap the phone lightly. */
export const useAction = <C extends PhoneChannel>(channel: C, options: { quiet?: boolean } = {}) => {
  const { computer, token } = useConnection()
  return useMutation<Response<C>, Error, Request<C>>({
    mutationFn: (payload) => {
      if (!computer || !token) throw new Error('No computer is connected.')
      return call(computer, token, channel, ...([payload] as PayloadArgs<C>))
    },
    onSuccess: () => {
      if (!options.quiet) void Haptics.selectionAsync()
    },
    onError: (error) => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      reportError(error)
    }
  })
}

/** The same read for several payloads at once (every project's board), sharing useCall's cache. */
export const useCalls = <C extends PhoneChannel>(channel: C, payloads: Request<C>[]) => {
  const { computer, token } = useConnection()
  return useQueries({
    queries: payloads.map((payload) => ({
      queryKey: [computer?.id, channel, payload],
      queryFn: () => call(computer!, token!, channel, ...([payload] as PayloadArgs<C>)),
      enabled: Boolean(computer && token)
    }))
  }) as { data?: Response<C>; isLoading: boolean; refetch: () => Promise<unknown> }[]
}

/** Each CLI's official mark by id, from the computer's registry (never a hardcoded list, AGENTS.md rule 15). */
export const useCliIcons = (projectId?: string) => {
  const clis = useCall('clis.list', projectId ? { projectId } : undefined, { staleTime: 10 * 60_000 })
  return useMemo(() => new Map((clis.data ?? []).map((c) => [c.id, c.icon])), [clis.data])
}
