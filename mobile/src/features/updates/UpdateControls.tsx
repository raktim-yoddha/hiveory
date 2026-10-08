import { StyleSheet, Switch, View } from 'react-native'
import { RefreshCw } from 'lucide-react-native'
import { space, useTheme } from '@/core/theme'
import { Button, Card, Text } from '@/core/ui'
import { offerUpdate } from './UpdatePrompt'
import { currentVersion, type UpdateCheck, UPDATES_SUPPORTED, useUpdates } from './useUpdates'

const describe = (check: UpdateCheck): string => {
  switch (check.state) {
    case 'idle':
      return `You have ${currentVersion()}.`
    case 'checking':
      return 'Checking…'
    case 'up-to-date':
      return `You are up to date (${currentVersion()}).`
    case 'available':
      return `Hiveory ${check.release.version} is available.`
    case 'error':
      return `Could not check: ${check.message}`
  }
}

/** Settings: automatic checks on launch, and Check now. Updates come from the official GitHub releases. */
export function UpdateControls() {
  const { colors } = useTheme()
  const autoCheck = useUpdates((s) => s.autoCheck)
  const check = useUpdates((s) => s.check)
  if (!UPDATES_SUPPORTED) {
    return (
      <Card>
        <Text variant="label" tone="muted">
          Updates come through the App Store or Expo here. The Android app checks GitHub releases.
        </Text>
      </Card>
    )
  }
  const checkNow = () => void useUpdates.getState().run().then((c) => c.state === 'available' && offerUpdate(c.release))
  return (
    <Card>
      <View style={styles.row}>
        <View style={styles.text}>
          <Text variant="lead">Check for updates automatically</Text>
          <Text variant="label" tone="muted">
            When the app opens, it asks GitHub for the latest Hiveory release. Nothing installs without your tap.
          </Text>
        </View>
        <Switch
          accessibilityLabel="Check for updates automatically"
          value={autoCheck}
          trackColor={{ true: colors.brand, false: colors.surfaceActive }}
          thumbColor={colors.text}
          onValueChange={(on) => void useUpdates.getState().setAutoCheck(on)}
        />
      </View>
      <View style={styles.row}>
        <Text variant="label" tone="muted" style={styles.text}>
          {describe(check)}
        </Text>
        <Button label="Check now" size="sm" icon={RefreshCw} disabled={check.state === 'checking'} onPress={checkNow} />
      </View>
    </Card>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space[6] },
  text: { flex: 1, gap: space[2] }
})
