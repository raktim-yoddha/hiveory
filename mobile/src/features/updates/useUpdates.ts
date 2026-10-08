import { Platform } from 'react-native'
import Constants, { ExecutionEnvironment } from 'expo-constants'
import { create } from 'zustand'
import { secureStore } from '@/core/storage/secure'
import { fetchLatestRelease, isNewer, type PhoneRelease } from './release'

const AUTO_CHECK_KEY = 'updates.autoCheck'

/** Only an installed Android app updates from GitHub; iPhones update through the App Store, Expo Go through Expo. */
export const UPDATES_SUPPORTED = Platform.OS === 'android' && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient

export const currentVersion = (): string => Constants.expoConfig?.version ?? '0.0.0'

export type UpdateCheck =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'up-to-date'; checkedAt: number }
  | { state: 'available'; release: PhoneRelease }
  | { state: 'error'; message: string }

interface UpdatesState {
  loaded: boolean
  autoCheck: boolean
  check: UpdateCheck
  load(): Promise<void>
  setAutoCheck(on: boolean): Promise<void>
  /** Asks GitHub for the latest release; the result lands in `check`. */
  run(): Promise<UpdateCheck>
}

export const useUpdates = create<UpdatesState>((set, get) => ({
  loaded: false,
  autoCheck: true,
  check: { state: 'idle' },
  load: async () => {
    const saved = await secureStore.get(AUTO_CHECK_KEY).catch(() => null)
    set({ loaded: true, autoCheck: saved !== 'off' })
  },
  setAutoCheck: async (on) => {
    set({ autoCheck: on })
    await secureStore.set(AUTO_CHECK_KEY, on ? 'on' : 'off').catch(() => undefined)
  },
  run: async () => {
    if (get().check.state === 'checking') return get().check
    set({ check: { state: 'checking' } })
    let check: UpdateCheck
    try {
      const release = await fetchLatestRelease()
      check = release && isNewer(release.version, currentVersion()) ? { state: 'available', release } : { state: 'up-to-date', checkedAt: Date.now() }
    } catch (error) {
      check = { state: 'error', message: error instanceof Error ? error.message : String(error) }
    }
    set({ check })
    return check
  }
}))
