import { StyleSheet, View } from 'react-native'
import { space, useTheme } from '@/core/theme'
import { Card, StatusDot, Text } from '@/core/ui'

interface Props {
  waiting: number
  working: number
  idle: number
  workspaces: number
}

const COLUMNS = [
  { key: 'waiting', status: 'waiting-for-you', label: 'Needs you', tone: 'waiting' },
  { key: 'working', status: 'working', label: 'Working', tone: 'working' },
  { key: 'idle', status: 'idle', label: 'Idle', tone: 'default' }
] as const

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** Every agent on the computer at a glance: one card, three counts, across all workspaces. */
export function Overview({ waiting, working, idle, workspaces }: Props) {
  const { colors } = useTheme()
  const counts = { waiting, working, idle }
  const total = waiting + working + idle
  return (
    <Card tone={waiting > 0 ? 'waiting' : 'default'}>
      <View
        accessible
        accessibilityLabel={`${plural(total, 'agent', 'agents')} in ${plural(workspaces, 'workspace', 'workspaces')}: ${waiting} need you, ${working} working, ${idle} idle`}
        style={styles.card}
      >
      <Text variant="label" tone="muted" numberOfLines={1}>
        {plural(total, 'agent', 'agents')} · {plural(workspaces, 'workspace', 'workspaces')}
      </Text>
      <View style={styles.row}>
        {COLUMNS.map((c, i) => (
          <View key={c.key} style={[styles.column, i === 0 ? styles.first : { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border }]}>
            <View style={styles.figure}>
              <Text variant="display" tone={counts[c.key] > 0 ? c.tone : 'muted'} style={styles.count}>
                {counts[c.key]}
              </Text>
              <StatusDot status={c.status} />
            </View>
            {/* The label has the column to itself; very narrow phones shrink it a little rather than cut it. */}
            <Text variant="label" tone="secondary" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
              {c.label}
            </Text>
          </View>
        ))}
      </View>
      </View>
    </Card>
  )
}

const styles = StyleSheet.create({
  card: { gap: space[5] },
  row: { flexDirection: 'row' },
  column: { flex: 1, gap: space[1], paddingHorizontal: space[4] },
  first: { paddingLeft: 0 },
  count: { fontVariant: ['tabular-nums'] },
  figure: { flexDirection: 'row', alignItems: 'center', gap: space[3] }
})
