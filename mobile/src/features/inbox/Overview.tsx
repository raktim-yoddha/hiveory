import { StyleSheet, View } from 'react-native'
import { space } from '@/core/theme'
import { Card, StatusDot, Text } from '@/core/ui'

interface Props {
  waiting: number
  working: number
  idle: number
  workspaces: number
}

const TILES = [
  { key: 'waiting', status: 'waiting-for-you', label: 'Needs you', tone: 'waiting' },
  { key: 'working', status: 'working', label: 'Working', tone: 'working' },
  { key: 'idle', status: 'idle', label: 'Idle', tone: 'muted' }
] as const

/** Every agent on the computer at a glance: how many need you, work, or wait idle, across all workspaces. */
export function Overview({ waiting, working, idle, workspaces }: Props) {
  const counts = { waiting, working, idle }
  return (
    <View style={styles.wrap} accessible accessibilityLabel={`${waiting} need you, ${working} working, ${idle} idle, across ${workspaces} workspaces`}>
      <View style={styles.row}>
        {TILES.map((t) => (
          <Card key={t.key} tone={t.key === 'waiting' && waiting > 0 ? 'waiting' : 'default'} style={styles.tile}>
            <Text variant="title" tone={counts[t.key] > 0 ? t.tone : 'muted'}>
              {counts[t.key]}
            </Text>
            <View style={styles.label}>
              <StatusDot status={t.status} />
              <Text variant="label" tone="muted" numberOfLines={1}>
                {t.label}
              </Text>
            </View>
          </Card>
        ))}
      </View>
      <Text variant="caption" tone="muted">
        Across {workspaces} {workspaces === 1 ? 'workspace' : 'workspaces'}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: space[3] },
  row: { flexDirection: 'row', gap: space[4] },
  tile: { flex: 1, gap: space[2], padding: space[6] },
  label: { flexDirection: 'row', alignItems: 'center', gap: space[2] }
})
