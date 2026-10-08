import { ScrollView, StyleSheet, View } from 'react-native'
import { BottomSheet } from '@expo/ui'
import { X } from 'lucide-react-native'
import { space, useTheme } from '../theme'
import { CustomSheet, type SheetProps } from './CustomSheet'
import { IconButton } from './IconButton'
import { Text } from './Text'

export type { SheetProps }

/**
 * A bottom sheet: choices and short forms open from where the thumb is. The platform's own sheet
 * (SwiftUI's on iOS with half and full heights, Material 3's on Android), drag to dismiss, in the
 * theme's raised surface with the app's own content. A question that must be answered keeps the
 * drawn sheet: it can't be swiped away.
 */
export function Sheet(props: SheetProps) {
  const { open, title, onClose, children, footer, dismissable = true } = props
  const { colors } = useTheme()
  if (!dismissable) return <CustomSheet {...props} />
  return (
    <BottomSheet isPresented={open} onDismiss={onClose} snapPoints={['half', 'full']} containerColor={colors.surfaceRaised} scrimColor={colors.overlay}>
      <View accessibilityViewIsModal style={styles.sheet}>
        <View style={styles.head}>
          <Text variant="title" style={styles.title} accessibilityRole="header">
            {title}
          </Text>
          <IconButton label="Close" icon={X} onPress={onClose} />
        </View>
        <ScrollView style={styles.fill} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </View>
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  sheet: { flex: 1, paddingBottom: space[7] },
  fill: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  title: { flex: 1 },
  body: { gap: space[5], paddingVertical: space[5] },
  footer: { flexDirection: 'row', gap: space[5], paddingTop: space[5] }
})
