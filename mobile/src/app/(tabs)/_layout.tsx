import { Redirect } from 'expo-router'
import { NativeTabs } from 'expo-router/unstable-native-tabs'
import { RouteErrorBoundary } from '@/core/boundary'
import { useComputers } from '@/core/computers'
import { useTheme } from '@/core/theme'
import { useNeedsYouCount } from '@/features/inbox'

export { RouteErrorBoundary as ErrorBoundary }

/**
 * The three places of the phone app: home (every agent, what needs you), workspaces, settings. The platform's own tab bar
 * (UITabBar with SF Symbols on iOS, Material navigation with Material icons on Android) in the
 * computer's theme. Each tab has its own native stack. Unpaired phones go to the welcome screen.
 */
export default function TabsLayout() {
  const { colors } = useTheme()
  const paired = useComputers((s) => s.computers.length > 0)
  const needsYou = useNeedsYouCount()
  if (!paired) return <Redirect href="/welcome" />
  return (
    <NativeTabs
      backgroundColor={colors.surface}
      iconColor={{ default: colors.textMuted, selected: colors.accent }}
      labelStyle={{ default: { color: colors.textMuted }, selected: { color: colors.accent } }}
      indicatorColor={colors.brandSoft}
      badgeBackgroundColor={colors.waiting}
      badgeTextColor={colors.accentContrast}
    >
      <NativeTabs.Trigger name="(inbox)">
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} md="home" />
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        {needsYou > 0 && <NativeTabs.Trigger.Badge>{String(needsYou)}</NativeTabs.Trigger.Badge>}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="projects">
        <NativeTabs.Trigger.Icon sf={{ default: 'folder', selected: 'folder.fill' }} md="folder" />
        <NativeTabs.Trigger.Label>Workspaces</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Icon sf={{ default: 'gearshape', selected: 'gearshape.fill' }} md="settings" />
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  )
}
