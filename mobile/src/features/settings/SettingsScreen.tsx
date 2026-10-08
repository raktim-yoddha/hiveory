import type { ReactNode } from 'react'
import { Alert, StyleSheet, View } from 'react-native'
import Constants from 'expo-constants'
import { router } from 'expo-router'
import { Check, Monitor, Plus, ShieldCheck, Trash2 } from 'lucide-react-native'
import { useConnection } from '@/core/api'
import { useComputers } from '@/core/computers'
import { routes } from '@/core/routes'
import { space, useTheme } from '@/core/theme'
import { Card, IconButton, ListRow, Screen, Section, StatusDot, Text, Button } from '@/core/ui'

const THEME_LABEL: Record<string, string> = { dark: 'Dark', bronze: 'Bronze', silver: 'Silver', midnight: 'Midnight', jade: 'Jade', rose: 'Rose' }

/**
 * The phone's settings. `notifications` and `updates` are composed in by the route (their
 * features own those controls), so no feature imports another.
 */
export function SettingsScreen({ notifications, updates }: { notifications?: ReactNode; updates?: ReactNode }) {
  const { colors, name } = useTheme()
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
        <Card>
          <Text variant="lead">Theme: {THEME_LABEL[name] ?? name}</Text>
          <Text variant="label" tone="muted">
            Follows the theme you picked in Hiveory on your computer.
          </Text>
        </Card>
      </Section>
      <Section title="Privacy">
        <Card>
          <View style={styles.trailing}>
            <ShieldCheck size={18} color={colors.working} />
            <Text variant="lead">Only your computers</Text>
          </View>
          <Text variant="label" tone="muted">
            This app talks only to the computers you paired, over your own Tailscale network. No Hiveory server sits in between. The only other request is the Android app asking GitHub for new releases, which you can turn off under Updates. Phones can watch and steer
            agents; deleting workspaces and changing settings stay on the computer.
          </Text>
        </Card>
      </Section>
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
