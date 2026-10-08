import { Platform } from 'react-native'
import Constants, { ExecutionEnvironment } from 'expo-constants'
import * as Device from 'expo-device'
import { create } from 'zustand'
import { setPushToken, type Computer } from '@/core/api'
import { secureStore } from '@/core/storage/secure'
import { Notifications } from './notifications-module'

const ENABLED_KEY = 'hiveory.push'
export const AGENTS_CHANNEL = 'agents'

export type PushStatus = 'off' | 'on' | 'denied' | 'unavailable'

/** Why push can't work here, in words the user can act on. */
export const PUSH_UNAVAILABLE = 'Needs the installed Hiveory app, not Expo Go.'

const projectId = (): string | undefined => Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId

/** Known before any tap: Expo Go, the web build, simulators and builds without an EAS project can't receive push. */
export const PUSH_SUPPORTED =
  Platform.OS !== 'web' && Boolean(Notifications) && Device.isDevice && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient && Boolean(projectId())

/** This phone's Expo push token, after asking permission; null when the user said no or push is unavailable here. */
const pushToken = async (): Promise<{ token: string } | { status: 'denied' | 'unavailable' }> => {
  const id = projectId()
  if (!PUSH_SUPPORTED || !Notifications || !id) return { status: 'unavailable' }
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(AGENTS_CHANNEL, { name: 'Agents that need you', importance: Notifications.AndroidImportance.HIGH })
  }
  const existing = await Notifications.getPermissionsAsync()
  const granted = existing.granted || (await Notifications.requestPermissionsAsync()).granted
  if (!granted) return { status: 'denied' }
  return { token: (await Notifications.getExpoPushTokenAsync({ projectId: id })).data }
}

interface PushState {
  status: PushStatus
  load(): Promise<void>
  /** Asks permission and tells every paired computer where to send "needs you" (ADR 0027). */
  enable(computers: { computer: Computer; token: string }[]): Promise<void>
  disable(computers: { computer: Computer; token: string }[]): Promise<void>
}

export const usePush = create<PushState>((set) => ({
  status: PUSH_SUPPORTED ? 'off' : 'unavailable',
  load: async () => {
    if (!PUSH_SUPPORTED) return set({ status: 'unavailable' })
    set({ status: (await secureStore.get(ENABLED_KEY).catch(() => null)) === 'on' ? 'on' : 'off' })
  },
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
