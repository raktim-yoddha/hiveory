import { Redirect } from 'expo-router'
import { Tabs } from 'expo-router/js-tabs'
import { Bot, FolderGit2, House, MessagesSquare, Settings } from 'lucide-react-native'
import { RouteErrorBoundary } from '@/core/boundary'
import { useComputers } from '@/core/computers'
import { TabBar } from '@/core/ui'
import { useNeedsYouCount } from '@/features/inbox'

export { RouteErrorBoundary as ErrorBoundary }

/**
 * The five places of the phone app, as on the computer (ADR 0039): Home (what needs you), Work (its
 * Workspaces), Bots, Chat and Settings. One tab bar whose selected pill holds icon and label; each
 * tab has its own stack. Unpaired phones go to the welcome screen.
 */
export default function TabsLayout() {
  const paired = useComputers((s) => s.computers.length > 0)
  const needsYou = useNeedsYouCount()
  if (!paired) return <Redirect href="/welcome" />
  return (
    <Tabs tabBar={(props) => <TabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="(inbox)" options={{ title: 'Home', tabBarIcon: ({ color, size }) => <House color={color} size={size} />, ...(needsYou > 0 ? { tabBarBadge: needsYou } : {}) }} />
      <Tabs.Screen name="projects" options={{ title: 'Work', tabBarIcon: ({ color, size }) => <FolderGit2 color={color} size={size} /> }} />
      <Tabs.Screen name="bots" options={{ title: 'Bots', tabBarIcon: ({ color, size }) => <Bot color={color} size={size} /> }} />
      <Tabs.Screen name="chat" options={{ title: 'Chat', tabBarIcon: ({ color, size }) => <MessagesSquare color={color} size={size} /> }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: ({ color, size }) => <Settings color={color} size={size} /> }} />
    </Tabs>
  )
}
