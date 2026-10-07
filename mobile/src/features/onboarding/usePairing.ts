import { useState } from 'react'
import * as Device from 'expo-device'
import * as Haptics from 'expo-haptics'
import { router } from 'expo-router'
import { HiveoryError } from '@/core/api'
import { NeedsCodeError, pairWith, useComputers, type PairTarget } from '@/core/computers'

export type PairState = { step: 'idle' } | { step: 'pairing'; address: string } | { step: 'needs-code'; target: PairTarget } | { step: 'failed'; message: string; hint?: string }

/** Pairs with a computer and opens the app on it; asks for the code only when the computer wants one. */
export const usePairing = () => {
  const [state, setState] = useState<PairState>({ step: 'idle' })
  const add = useComputers((s) => s.add)

  const pair = async (target: PairTarget): Promise<void> => {
    setState({ step: 'pairing', address: target.address })
    try {
      const { computer, token } = await pairWith(target, Device.deviceName ?? Device.modelName ?? 'Phone')
      await add(computer, token)
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      router.replace('/')
    } catch (error) {
      if (error instanceof NeedsCodeError) return setState({ step: 'needs-code', target })
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      const e = error instanceof HiveoryError ? error.error : { message: 'Pairing failed.', hint: undefined }
      setState({ step: 'failed', message: e.message, hint: e.hint })
    }
  }

  return { state, pair, reset: () => setState({ step: 'idle' }) }
}
