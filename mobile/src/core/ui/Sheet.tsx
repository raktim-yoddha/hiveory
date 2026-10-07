import type { ReactNode } from 'react'
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { X } from 'lucide-react-native'
import { radius, space, useTheme } from '../theme'
import { IconButton } from './IconButton'
import { Text } from './Text'

export interface SheetProps {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  /** Pinned under the content (the sheet's main actions, in thumb reach). */
  footer?: ReactNode
  /** Questions that must be answered cannot be swiped or tapped away. */
  dismissable?: boolean
}

/** A bottom sheet: choices and short forms open from where the thumb is. */
export function Sheet({ open, title, onClose, children, footer, dismissable = true }: SheetProps) {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={dismissable ? onClose : () => undefined} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
        <Pressable accessibilityLabel="Close" accessibilityRole="button" style={[styles.fill, { backgroundColor: colors.overlay }]} onPress={dismissable ? onClose : undefined} />
        <View accessibilityViewIsModal style={[styles.sheet, { backgroundColor: colors.surfaceRaised, paddingBottom: Math.max(insets.bottom, space[7]) }]}>
          <View style={[styles.grabber, { backgroundColor: colors.borderStrong }]} />
          <View style={styles.head}>
            <Text variant="title" style={styles.title} accessibilityRole="header">
              {title}
            </Text>
            {dismissable ? <IconButton label="Close" icon={X} onPress={onClose} /> : null}
          </View>
          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  sheet: { borderTopLeftRadius: radius.lg + 8, borderTopRightRadius: radius.lg + 8, maxHeight: '88%', paddingHorizontal: space[7] },
  grabber: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, marginTop: space[4], marginBottom: space[3] },
  head: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  title: { flex: 1 },
  body: { flexGrow: 0 },
  bodyContent: { gap: space[5], paddingVertical: space[5] },
  footer: { flexDirection: 'row', gap: space[5], paddingTop: space[5] }
})
