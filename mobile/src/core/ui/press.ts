import { Platform, type PressableAndroidRippleConfig } from 'react-native'

/**
 * Native touch feedback in the theme's color: Android's ripple, and on iOS the pressed highlight
 * (a fill while the finger is down). A pressable uses both: `android_ripple={ripple(c)}` and
 * `backgroundColor: pressedFill(pressed, c, rest)`. Its corners clip the ripple (`overflow: 'hidden'`).
 */
export const ripple = (color: string, borderless = false): PressableAndroidRippleConfig | undefined =>
  Platform.OS === 'android' ? { color, borderless, foreground: true } : undefined

export const pressedFill = (pressed: boolean, highlight: string, rest: string): string =>
  Platform.OS !== 'android' && pressed ? highlight : rest
