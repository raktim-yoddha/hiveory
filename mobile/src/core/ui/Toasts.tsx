import { Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CircleAlert, Info } from 'lucide-react-native'
import { useNotices } from '../notices'
import { radius, space, useTheme } from '../theme'
import { Text } from './Text'

/** The current notice, above the tab bar; tap to dismiss. Screen readers hear it at once. */
export function Toasts() {
  const notices = useNotices((s) => s.notices)
  const dismiss = useNotices((s) => s.dismiss)
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const notice = notices[0]
  if (!notice) return null
  const error = notice.level === 'error'
  const Icon = error ? CircleAlert : Info
  return (
    <View pointerEvents="box-none" style={[styles.layer, { bottom: insets.bottom + 72 }]}>
      <Pressable
        accessibilityRole="alert"
        accessibilityLiveRegion="assertive"
        accessibilityLabel={[notice.message, notice.hint].filter(Boolean).join('. ')}
        onPress={() => dismiss(notice.id)}
        style={[styles.toast, { backgroundColor: colors.surfaceActive }]}
      >
        <Icon size={18} color={error ? colors.danger : colors.accent} />
        <View style={styles.text}>
          <Text variant="label">{notice.message}</Text>
          {notice.hint ? (
            <Text variant="caption" tone="secondary">
              {notice.hint}
            </Text>
          ) : null}
        </View>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: space[7] },
  toast: { flexDirection: 'row', gap: space[5], alignItems: 'flex-start', padding: space[6], borderRadius: radius.md, maxWidth: 520, alignSelf: 'stretch' },
  text: { flex: 1, gap: space[1] }
})
