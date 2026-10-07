import { Platform } from 'react-native'
import Constants from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { create } from 'zustand'
import { setPushToken, type Computer } from '@/core/api'
import { secureStore } from '@/core/storage/secure'

const ENABLED_KEY = 'hiveory.push'
export const AGENTS_CHANNEL = 'agents'

export type PushStatus = 'off' | 'on' | 'denied' | 'unavailable'

/** Why push can't work here, in words the user can act on. */
export const PUSH_UNAVAILABLE = 'Notifications need the installed Hiveory app on a real phone (not Expo Go), set up with an EAS project.'

/** This phone's Expo push token, after asking permission; null when the user said no or push is unavailable here. */
const pushToken = async (): Promise<{ token: string } | { status: 'denied' | 'unavailable' }> => {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId
  if (!Device.isDevice || !projectId) return { status: 'unavailable' }
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(AGENTS_CHANNEL, { name: 'Agents that need you', importance: Notifications.AndroidImportance.HIGH })
  }
  const existing = await Notifications.getPermissionsAsync()
  const granted = existing.granted || (await Notifications.requestPermissionsAsync()).granted
  if (!granted) return { status: 'denied' }
  return { token: (await Notifications.getExpoPushTokenAsync({ projectId })).data }
}

interface PushState {
  status: PushStatus
  load(): Promise<void>
  /** Asks permission and tells every paired computer where to send "needs you" (ADR 0027). */
  enable(computers: { computer: Computer; token: string }[]): Promise<void>
  disable(computers: { computer: Computer; token: string }[]): Promise<void>
}

export const usePush = create<PushState>((set) => ({
  status: 'off',
  load: async () => set({ status: (await secureStore.get(ENABLED_KEY).catch(() => null)) === 'on' ? 'on' : 'off' }),
  enable: async (computers) => {
    const result = await pushToken().catch(() => ({ status: 'unavailable' as const }))
    if ('status' in result) return set({ status: result.status })
    await Promise.allSettled(computers.map((c) => setPushToken(c.computer, c.token, result.token)))
    await secureStore.set(ENABLED_KEY, 'on')
    set({ status: 'on' })
  },
  disable: async (computers) => {
    await Promise.allSettled(computers.map((c) => setPushToken(c.computer, c.token, null)))
    await secureStore.set(ENABLED_KEY, 'off')
    set({ status: 'off' })
  }
}))
