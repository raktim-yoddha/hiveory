import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { QueryClientProvider } from '@tanstack/react-query'
import { ConnectionProvider, createQueryClient, useCall } from '@/core/api'
import { LayerBoundary, RouteErrorBoundary } from '@/core/boundary'
import { useComputers } from '@/core/computers'
import { font, ThemeProvider, useTheme } from '@/core/theme'
import { Toasts } from '@/core/ui'
import { NotificationRouter } from '@/features/notifications'
import { SshPromptSheet } from '@/features/ssh-prompts'

export { RouteErrorBoundary as ErrorBoundary }

/**
 * The app shell (ADR 0027): paired computers load from secure storage, then the
 * live connection, the computer's theme, the screens, and the app-wide layers
 * (SSH questions, notification taps, notices). Each is its own feature; one
 * failing never takes the others down.
 */
export default function RootLayout() {
  const [queryClient] = useState(createQueryClient)
  const loaded = useComputers((s) => s.loaded)
  useEffect(() => void useComputers.getState().load(), [])
  if (!loaded) return null
  return (
    <QueryClientProvider client={queryClient}>
      <ConnectionProvider>
        <ThemeFromComputer>
          <Shell />
        </ThemeFromComputer>
      </ConnectionProvider>
    </QueryClientProvider>
  )
}

/** The phone wears the theme picked on the computer. */
function ThemeFromComputer({ children }: { children: React.ReactNode }) {
  const settings = useCall('settings.get', undefined)
  return <ThemeProvider desired={settings.data?.theme}>{children}</ThemeProvider>
}

function Shell() {
  const { colors } = useTheme()
  return (
    <View style={[styles.fill, { backgroundColor: colors.bg }]}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.accent,
          headerTitleStyle: { color: colors.text, fontSize: font.size.lead, fontWeight: font.weight.semibold },
          headerShadowVisible: false,
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: colors.bg }
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="welcome" options={{ headerShown: false }} />
        <Stack.Screen name="pair" options={{ title: 'Connect a computer', presentation: 'modal' }} />
      </Stack>
      {/* Each app-wide layer fails alone: a broken one shows nothing, every screen keeps working. */}
      <LayerBoundary name="SSH questions">
        <SshPromptSheet />
      </LayerBoundary>
      <LayerBoundary name="Notification taps">
        <NotificationRouter />
      </LayerBoundary>
      <LayerBoundary name="Notices">
        <Toasts />
      </LayerBoundary>
    </View>
  )
}

const styles = StyleSheet.create({ fill: { flex: 1 } })
