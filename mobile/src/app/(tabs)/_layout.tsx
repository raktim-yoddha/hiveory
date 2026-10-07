import { Redirect, Tabs } from 'expo-router'
import { FolderKanban, Inbox, Settings } from 'lucide-react-native'
import { RouteErrorBoundary } from '@/core/boundary'
import { useComputers } from '@/core/computers'
import { font, useTheme } from '@/core/theme'
import { useNeedsYouCount } from '@/features/inbox'

export { RouteErrorBoundary as ErrorBoundary }

/** The three places of the phone app: what needs you, projects, settings. Unpaired phones go to the welcome screen. */
export default function TabsLayout() {
  const { colors } = useTheme()
  const paired = useComputers((s) => s.computers.length > 0)
  const needsYou = useNeedsYouCount()
  if (!paired) return <Redirect href="/welcome" />
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTitleStyle: { color: colors.text, fontSize: font.size.lead, fontWeight: font.weight.semibold },
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        sceneStyle: { backgroundColor: colors.bg }
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Inbox',
          tabBarIcon: ({ color, size }) => <Inbox color={color} size={size} />,
          tabBarBadge: needsYou || undefined,
          tabBarBadgeStyle: { backgroundColor: colors.waiting, color: colors.accentContrast },
          tabBarAccessibilityLabel: needsYou ? `Inbox, ${needsYou} need you` : 'Inbox'
        }}
      />
      <Tabs.Screen name="projects" options={{ title: 'Workspaces', tabBarIcon: ({ color, size }) => <FolderKanban color={color} size={size} /> }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: ({ color, size }) => <Settings color={color} size={size} /> }} />
    </Tabs>
  )
}
