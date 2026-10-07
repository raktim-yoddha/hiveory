import { Platform } from 'react-native'
import * as SecureStore from 'expo-secure-store'

/** Small values kept in the iOS Keychain / Android Keystore (tokens, the paired computers). */
export interface KeyValueStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
}

const native: KeyValueStore = {
  get: (key) => SecureStore.getItemAsync(key),
  set: (key, value) => SecureStore.setItemAsync(key, value),
  remove: (key) => SecureStore.deleteItemAsync(key)
}

/** The web build (previews in a browser) has no keychain: the browser's own storage for that origin. */
const web: KeyValueStore = {
  get: async (key) => globalThis.localStorage?.getItem(key) ?? null,
  set: async (key, value) => globalThis.localStorage?.setItem(key, value),
  remove: async (key) => globalThis.localStorage?.removeItem(key)
}

export const secureStore: KeyValueStore = Platform.OS === 'web' ? web : native

/** In memory only (tests). */
export const memoryStore = (): KeyValueStore => {
  const values = new Map<string, string>()
  return {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => void values.set(key, value),
    remove: async (key) => void values.delete(key)
  }
}
