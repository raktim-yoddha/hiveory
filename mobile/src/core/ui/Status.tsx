import { StyleSheet, View } from 'react-native'
import type { CliStatus } from '@shared/domain/cli'
import { radius, space, useTheme, type Palette } from '../theme'
import { Text } from './Text'

/** The three statuses, exactly (AGENTS.md rule 6), in the order a phone shows them: what needs you first. */
export const STATUS_ORDER: CliStatus[] = ['waiting-for-you', 'working', 'idle']
export const STATUS_LABEL: Record<CliStatus, string> = { 'waiting-for-you': 'Needs you', working: 'Working', idle: 'Idle' }

const statusColor = (c: Palette, status: CliStatus): { fg: string; bg: string } =>
  status === 'waiting-for-you' ? { fg: c.waiting, bg: c.waitingSoft } : status === 'working' ? { fg: c.working, bg: c.workingSoft } : { fg: c.idle, bg: c.surfaceRaised }

export function StatusDot({ status, size = 8 }: { status: CliStatus; size?: number }) {
  const { colors } = useTheme()
  return <View accessibilityLabel={STATUS_LABEL[status]} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: statusColor(colors, status).fg }} />
}

export function StatusPill({ status }: { status: CliStatus }) {
  const { colors } = useTheme()
  const c = statusColor(colors, status)
  return (
    <View style={[styles.pill, { backgroundColor: c.bg }]}>
      <StatusDot status={status} size={6} />
      <Text variant="caption" style={{ color: c.fg, fontWeight: '600' }}>
        {STATUS_LABEL[status]}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[5], paddingVertical: space[2], borderRadius: radius.pill }
})
