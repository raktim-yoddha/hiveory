import { StyleSheet, Switch, View } from 'react-native'
import { BellRing } from 'lucide-react-native'
import { useComputers } from '@/core/computers'
import { space, useTheme } from '@/core/theme'
import { Button, Card, Text } from '@/core/ui'
import { PUSH_UNAVAILABLE, usePush } from './push'

const paired = () => {
  const { computers, tokens } = useComputers.getState()
  return computers.flatMap((c) => (tokens[c.id] ? [{ computer: c, token: tokens[c.id]! }] : []))
}

const NOTE = {
  off: 'Even with the app closed. No names or code are sent.',
  on: 'On, even with the app closed.',
  denied: 'Turned off for Hiveory in the phone’s settings.',
  unavailable: PUSH_UNAVAILABLE
}

/** The on/off switch for "needs you" notifications (Settings); no switch where push can't work. */
export function PushToggle() {
  const { colors } = useTheme()
  const status = usePush((s) => s.status)
  return (
    <Card>
      <View style={styles.row}>
        <View style={styles.text}>
          <Text variant="lead" numberOfLines={1}>
            Needs-you alerts
          </Text>
          <Text variant="label" tone="muted" numberOfLines={2}>
            {NOTE[status]}
          </Text>
        </View>
        {status === 'unavailable' ? null : (
          <Switch
            accessibilityLabel="Needs-you alerts"
            value={status === 'on'}
            trackColor={{ true: colors.brand, false: colors.surfaceActive }}
            thumbColor={colors.text}
            onValueChange={(on) => void (on ? usePush.getState().enable(paired()) : usePush.getState().disable(paired()))}
          />
        )}
      </View>
    </Card>
  )
}

/** A one-time suggestion on the home screen until notifications are on (or impossible). */
export function PushSuggestion() {
  const { colors } = useTheme()
  const status = usePush((s) => s.status)
  if (status !== 'off') return null
  return (
    <Card>
      <View style={styles.row}>
        <BellRing size={22} color={colors.accent} />
        <View style={styles.text}>
          <Text variant="lead">Get told when an agent needs you</Text>
          <Text variant="label" tone="muted">
            Even with the app closed. Only that it needs you is sent.
          </Text>
        </View>
      </View>
      <Button label="Turn on" variant="primary" onPress={() => void usePush.getState().enable(paired())} />
    </Card>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space[6] },
  text: { flex: 1, gap: space[2] }
})
