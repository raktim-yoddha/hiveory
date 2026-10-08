import { useMemo } from 'react'
import { font } from './tokens'
import { useTheme } from './ThemeProvider'

/**
 * The platform's own navigation header (UINavigationBar / Material top app bar) in the computer's
 * theme: native behaviour and type, the desktop's colors. Every stack in the app uses it.
 */
export function useHeaderOptions() {
  const { colors } = useTheme()
  return useMemo(
    () => ({
      headerStyle: { backgroundColor: colors.bg },
      headerTintColor: colors.accent,
      headerTitleStyle: { color: colors.text, fontSize: font.size.lead, fontWeight: font.weight.semibold },
      headerLargeTitleStyle: { color: colors.text },
      headerShadowVisible: false,
      headerBackButtonDisplayMode: 'minimal' as const,
      contentStyle: { backgroundColor: colors.bg }
    }),
    [colors]
  )
}
