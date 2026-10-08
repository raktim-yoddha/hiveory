import Constants, { ExecutionEnvironment } from 'expo-constants'

export type NotificationsModule = typeof import('expo-notifications')

/**
 * expo-notifications, or null in Expo Go: SDK 53 removed push from Expo Go and the module
 * throws as soon as it is imported on Android, which took the whole app down with it.
 * Loaded lazily so Expo Go never evaluates it; push lives in a development or store build.
 */
export const Notifications: NotificationsModule | null =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient
    ? null
    : // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('expo-notifications') as NotificationsModule)
