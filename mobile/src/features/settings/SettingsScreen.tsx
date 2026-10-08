import { useState, type ReactNode } from 'react'
import { Alert, StyleSheet, View } from 'react-native'
import Constants from 'expo-constants'
import { router } from 'expo-router'
import { Check, ChevronRight, Monitor, Palette, Plus, ShieldCheck, Trash2 } from 'lucide-react-native'
import { useCall, useConnection } from '@/core/api'
import { useComputers } from '@/core/computers'
import { routes } from '@/core/routes'
import { space, useTheme } from '@/core/theme'
import { IconButton, ListRow, Screen, Section, StatusDot, Text, Button } from '@/core/ui'
import { ThemeSheet, themeLabel } from './ThemeSheet'

/**
 * The phone's settings. `notifications` and `updates` are composed in by the route (their
 * features own those controls), so no feature imports another.
 */
export function SettingsScreen({ notifications, updates }: { notifications?: ReactNode; updates?: ReactNode }) {
  const { colors, choice } = useTheme()
  const [picking, setPicking] = useState(false)
  const computerTheme = useCall('settings.get', undefined).data?.theme
  const { status } = useConnection()
  const computers = useComputers((s) => s.computers)
  const activeId = useComputers((s) => s.activeId)
  const { setActive, remove } = useComputers.getState()

  const forget = (id: string, label: string): void =>
    Alert.alert(`Forget ${label}?`, 'This phone stops seeing it. To also remove the phone there: Settings › Remote › Paired devices.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Forget',
        style: 'destructive',
        onPress: () =>
          void remove(id).then(() => {
            if (!useComputers.getState().computers.length) router.replace(routes.inbox)
          })
      }
    ])

  return (
    <Screen>
      <Section title="Computers" aside={<Button label="Add" size="sm" icon={Plus} onPress={() => router.push(routes.pair)} />}>
        {computers.map((c) => {
          const active = c.id === activeId
          return (
            <ListRow
              key={c.id}
              title={c.name}
              subtitle={active ? (status === 'online' ? 'Connected' : status === 'connecting' ? 'Connecting…' : 'Not reachable') : c.address}
              label={`${c.name}${active ? ', in use' : ''}`}
              leading={active ? <StatusDot status={status === 'online' ? 'working' : status === 'connecting' ? 'waiting-for-you' : 'idle'} size={10} /> : <Monitor size={18} color={colors.textMuted} />}
              trailing={
                <View style={styles.trailing}>
                  {active ? <Check size={18} color={colors.accent} accessibilityLabel="In use" /> : null}
                  <IconButton label={`Forget ${c.name}`} icon={Trash2} onPress={() => forget(c.id, c.name)} />
                </View>
              }
              onPress={active ? undefined : () => void setActive(c.id)}
            />
          )
        })}
      </Section>
      {notifications ? <Section title="Notifications">{notifications}</Section> : null}
      {updates ? <Section title="Updates">{updates}</Section> : null}
      <Section title="Appearance">
        <ListRow
          title="Theme"
          subtitle={themeLabel(choice, computerTheme)}
          leading={<Palette size={18} color={colors.textMuted} />}
          trailing={<ChevronRight size={18} color={colors.textMuted} />}
          onPress={() => setPicking(true)}
        />
      </Section>
      <ListRow
        title="Only your computers"
        subtitle="Over your Tailscale network. No Hiveory server in between."
        leading={<ShieldCheck size={18} color={colors.working} />}
      />
      <ThemeSheet open={picking} onClose={() => setPicking(false)} computerTheme={computerTheme} />
      <Text variant="caption" tone="muted" style={styles.version}>
        Hiveory for phones {Constants.expoConfig?.version ?? ''}
      </Text>
    </Screen>
  )
}

const styles = StyleSheet.create({
  trailing: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  version: { textAlign: 'center' }
})
