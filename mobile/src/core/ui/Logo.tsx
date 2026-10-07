import { Image } from 'react-native'

/** Hiveory's mark, flat as on the desktop (design.md: no glow, shadow or gradient). */
export function Logo({ size = 72 }: { size?: number }) {
  return <Image source={require('../../../assets/logo.png')} style={{ width: size, height: size }} accessibilityLabel="Hiveory" accessibilityIgnoresInvertColors />
}
