import { StyleSheet, View } from 'react-native'
import { ShieldAlert } from 'lucide-react-native'
import { useAction, useCall } from '@/core/api'
import { space, useTheme } from '@/core/theme'
import { Button, Card, Section, Text } from '@/core/ui'

/**
 * Bot calls waiting for the user's yes (ADR 0029), answered from the phone too (ADR 0052): what the
 * bot wants to do, its arguments as plain text, Allow or Decline. `botId` narrows it to one bot.
 */
export function Approvals({ botId }: { botId?: string }) {
  const { colors } = useTheme()
  const requests = useCall('approvals.list', undefined)
  const bots = useCall('bots.list', undefined)
  const answer = useAction('approvals.answer')
  const waiting = (requests.data ?? []).filter((r) => !botId || r.botId === botId)
  if (!waiting.length) return null
  const nameOf = (id: string): string => bots.data?.find((b) => b.id === id)?.name ?? 'A bot'

  return (
    <Section title="Needs you">
      {waiting.map((r) => (
        <Card key={r.id} tone="waiting">
          <View style={styles.head}>
            <ShieldAlert size={18} color={colors.waiting} />
            <Text variant="lead" style={styles.title}>
              {nameOf(r.botId)} wants to {r.risk === 'send' ? 'send or post as you' : 'change something in your apps'}
            </Text>
          </View>
          <Text variant="mono" tone="secondary">
            {r.tool}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={8}>
            {r.detail}
          </Text>
          <Text variant="caption" tone="muted">
            Declined by itself after 15 minutes.
          </Text>
          <View style={styles.actions}>
            <Button label="Decline" variant="ghost" size="sm" disabled={answer.isPending} onPress={() => answer.mutate({ approvalId: r.id, allow: false })} />
            <Button label="Allow" variant="primary" size="sm" disabled={answer.isPending} onPress={() => answer.mutate({ approvalId: r.id, allow: true })} />
          </View>
        </Card>
      ))}
    </Section>
  )
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  title: { flex: 1 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space[4] }
})
