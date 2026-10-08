import { Platform } from 'react-native'
import { Stack } from 'expo-router'
import { useHeaderOptions } from '../theme'

/** One tab's own native stack: the platform header (a large title on iOS), in the computer's theme. */
export function TabStack({ title }: { title: string }) {
  const header = useHeaderOptions()
  return (
    <Stack screenOptions={header}>
      <Stack.Screen name="index" options={{ title, headerLargeTitleEnabled: Platform.OS === 'ios' }} />
    </Stack>
  )
}
