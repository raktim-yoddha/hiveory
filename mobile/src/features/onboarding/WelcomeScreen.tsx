import { StyleSheet, View } from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Monitor, QrCode, Waypoints } from 'lucide-react-native'
import { radius, space, useTheme } from '@/core/theme'
import { Button, Card, Logo, Text, type IconComponent } from '@/core/ui'

const STEPS: { icon: IconComponent; title: string; body: string }[] = [
  { icon: Waypoints, title: 'Tailscale on both', body: 'Install Tailscale on this phone and your computer, signed in to the same account.' },
  { icon: Monitor, title: 'Share your computer', body: 'In Hiveory on the computer: Settings › Remote › Share this computer.' },
  { icon: QrCode, title: 'Scan its code', body: 'It shows a code under "Connect your phone". Scan it here.' }
]

/** First run: what the phone needs, in three steps, and the one button that starts it. */
export function WelcomeScreen() {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <View style={[styles.page, { backgroundColor: colors.bg, paddingTop: insets.top + space[10], paddingBottom: insets.bottom + space[7] }]}>
      <View style={styles.hero}>
        <Logo size={88} />
        <Text variant="display" style={styles.center}>
          Your agents, in your pocket
        </Text>
        <Text tone="secondary" style={styles.center}>
          Watch them work, answer when they need you, and keep them going from anywhere.
        </Text>
      </View>
      <View style={styles.steps}>
        {STEPS.map(({ icon: Icon, title, body }, i) => (
          <Card key={title} style={styles.step}>
            <View style={styles.stepRow}>
              <View style={[styles.stepIcon, { backgroundColor: colors.brandSoft }]}>
                <Icon size={20} color={colors.accent} />
              </View>
              <View style={styles.stepText}>
                <Text variant="lead">
                  {i + 1}. {title}
                </Text>
                <Text variant="label" tone="muted">
                  {body}
                </Text>
              </View>
            </View>
          </Card>
        ))}
      </View>
      <View style={styles.actions}>
        <Button label="Scan pairing code" variant="primary" icon={QrCode} block onPress={() => router.push('/pair')} />
        <Button label="Enter the address instead" variant="ghost" block onPress={() => router.push({ pathname: '/pair', params: { manual: '1' } })} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: space[8], justifyContent: 'space-between', gap: space[8] },
  hero: { alignItems: 'center', gap: space[5] },
  center: { textAlign: 'center' },
  steps: { gap: space[5] },
  step: { padding: space[6] },
  stepRow: { flexDirection: 'row', gap: space[6], alignItems: 'flex-start' },
  stepIcon: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  stepText: { flex: 1, gap: space[2] },
  actions: { gap: space[4] }
})
