import { StyleSheet, Switch, View } from 'react-native'
import { space, useTheme } from '../theme'
import { Text } from './Text'

/** One on/off setting: what it does in words, and the platform switch. */
export function SwitchRow({ label, hint, value, onChange, disabled }: { label: string; hint?: string; value: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
  const { colors } = useTheme()
  return (
    <View style={styles.row}>
      <View style={styles.text}>
        <Text>{label}</Text>
        {hint ? (
          <Text variant="caption" tone="muted">
            {hint}
          </Text>
        ) : null}
      </View>
      <Switch accessibilityLabel={label} value={value} disabled={disabled} trackColor={{ true: colors.brand, false: colors.surfaceActive }} thumbColor={colors.text} onValueChange={onChange} />
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space[5], minHeight: 44 },
  text: { flex: 1, gap: space[1] }
})
