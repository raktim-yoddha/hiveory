import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { secureStore } from '../storage/secure'
import { PALETTES } from './palettes'
import { DEFAULT_THEME, type Palette, type ThemeName } from './tokens'

const SAVED_KEY = 'hiveory.theme'

interface ThemeValue {
  name: ThemeName
  colors: Palette
}

const ThemeContext = createContext<ThemeValue>({ name: DEFAULT_THEME, colors: PALETTES[DEFAULT_THEME] })

const isTheme = (value: unknown): value is ThemeName => typeof value === 'string' && value in PALETTES

/**
 * The phone wears the computer's theme (ADR 0027): `desired` comes from the
 * computer's settings; the last one is remembered so the app opens in it.
 */
export function ThemeProvider({ desired, children }: { desired?: string; children: ReactNode }) {
  const [saved, setSaved] = useState<ThemeName>(DEFAULT_THEME)
  // The computer's choice wins; until it answers, the one remembered from last time.
  const name = isTheme(desired) ? desired : saved

  useEffect(() => {
    void secureStore.get(SAVED_KEY).then((value) => isTheme(value) && setSaved(value), () => undefined)
  }, [])

  useEffect(() => {
    if (isTheme(desired)) void secureStore.set(SAVED_KEY, desired).catch(() => undefined)
  }, [desired])

  const value = useMemo(() => ({ name, colors: PALETTES[name] }), [name])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export const useTheme = (): ThemeValue => useContext(ThemeContext)
