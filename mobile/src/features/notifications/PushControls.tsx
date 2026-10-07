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
  off: 'Your phone tells you when an agent needs you, even when Hiveory is closed. Only that it needs you is sent, never names or code.',
  on: 'On. Your phone tells you when an agent needs you.',
  denied: 'Notifications are turned off for Hiveory in the phone’s settings.',
  unavailable: PUSH_UNAVAILABLE
}

/** The on/off switch for "needs you" notifications (Settings). */
export function PushToggle() {
  const { colors } = useTheme()
  const status = usePush((s) => s.status)
  return (
    <Card>
      <View style={styles.row}>
        <View style={styles.text}>
          <Text variant="lead">Notify me when an agent needs me</Text>
          <Text variant="label" tone="muted">
            {NOTE[status]}
          </Text>
        </View>
        <Switch
          accessibilityLabel="Notify me when an agent needs me"
          value={status === 'on'}
          trackColor={{ true: colors.brand, false: colors.surfaceActive }}
          thumbColor={colors.text}
          onValueChange={(on) => void (on ? usePush.getState().enable(paired()) : usePush.getState().disable(paired()))}
        />
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
