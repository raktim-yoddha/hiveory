import { StyleSheet, View } from 'react-native'
import type { CliRuntimeDetails, IconReference, WaitingReason } from '@shared/domain/cli'
import { space } from '../theme'
import { Card } from './Card'
import { CliLogo } from './CliLogo'
import { ListRow } from './ListRow'
import { StatusDot, StatusPill } from './Status'
import { Text } from './Text'

const WAITING: Record<WaitingReason, string> = {
  permission: 'Wants your permission',
  input: 'Waiting for your answer',
  confirmation: 'Asks you to confirm',
  other: 'Waiting for you'
}

/** What an agent is doing, in one line: why it waits, its activity, or its error. */
export const agentLine = (runtime: CliRuntimeDetails): string | undefined =>
  runtime.error ?? (runtime.status === 'waiting-for-you' ? WAITING[runtime.waitingReason ?? 'other'] : runtime.activity) ?? (runtime.running ? undefined : 'Not running')

export interface AgentCardProps {
  petName: string
  icon?: IconReference
  runtime: CliRuntimeDetails
  /** Where it works, e.g. "app · fix-login". */
  place?: string
  onPress: () => void
  /** A slim row (lists of working or idle agents) instead of a full card. */
  compact?: boolean
}

/**
 * One agent, as the board shows it (same model as the desktop's Kanban card,
 * AGENTS.md rule 6): its pet name, CLI, status and what it is doing.
 */
export function AgentCard({ petName, icon, runtime, place, onPress, compact }: AgentCardProps) {
  const line = agentLine(runtime)
  if (compact) {
    return (
      <ListRow
        title={petName}
        subtitle={[place, line].filter(Boolean).join(' · ')}
        leading={<CliLogo icon={icon} size={28} />}
        trailing={<StatusDot status={runtime.status} />}
        onPress={onPress}
      />
    )
  }
  return (
    <Card tone={runtime.status === 'waiting-for-you' ? 'waiting' : 'default'} onPress={onPress} label={[petName, place, line].filter(Boolean).join(', ')}>
      <View style={styles.head}>
        <CliLogo icon={icon} size={32} />
        <View style={styles.names}>
          <Text variant="lead" numberOfLines={1}>
            {petName}
          </Text>
          {place ? (
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {place}
            </Text>
          ) : null}
        </View>
        <StatusPill status={runtime.status} />
      </View>
      {line ? (
        <Text tone={runtime.error ? 'danger' : 'secondary'} numberOfLines={3}>
          {line}
        </Text>
      ) : null}
    </Card>
  )
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space[5] },
  names: { flex: 1, minWidth: 0 }
})
