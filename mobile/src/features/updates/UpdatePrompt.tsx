import { useEffect } from 'react'
import { Alert, Linking } from 'react-native'
import type { PhoneRelease } from './release'
import { UPDATES_SUPPORTED, useUpdates } from './useUpdates'

/** The native "update available" pop-up: Later, or Update, which downloads the APK for Android to install. */
export const offerUpdate = (release: PhoneRelease): void =>
  Alert.alert(
    `Hiveory ${release.version} is available`,
    [...release.highlights.map((h) => `• ${h}`), '', 'Android asks you to confirm the install.'].join('\n').trim(),
    [
      { text: 'Later', style: 'cancel' },
      { text: 'Update', onPress: () => void Linking.openURL(release.url) }
    ]
  )

/** App-wide layer: on launch, if automatic checks are on, looks once and offers a newer version. */
export function UpdatePrompt() {
  const loaded = useUpdates((s) => s.loaded)
  const autoCheck = useUpdates((s) => s.autoCheck)
  useEffect(() => {
    if (UPDATES_SUPPORTED) void useUpdates.getState().load()
  }, [])
  useEffect(() => {
    if (!UPDATES_SUPPORTED || !loaded || !autoCheck) return
    void useUpdates
      .getState()
      .run()
      .then((check) => check.state === 'available' && offerUpdate(check.release))
  }, [loaded, autoCheck])
  return null
}
