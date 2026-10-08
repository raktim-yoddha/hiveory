import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { secureStore } from '../storage/secure'
import { PALETTES } from './palettes'
import { DEFAULT_THEME, type Palette, type ThemeName } from './tokens'

const SAVED_KEY = 'hiveory.theme'
const CHOICE_KEY = 'hiveory.themeChoice'

/** The phone's own pick: a theme, or the computer's ("computer"). Only the phone changes. */
export type ThemeChoice = ThemeName | 'computer'

interface ThemeValue {
  name: ThemeName
  colors: Palette
  choice: ThemeChoice
  setChoice(choice: ThemeChoice): void
}

const ThemeContext = createContext<ThemeValue>({ name: DEFAULT_THEME, colors: PALETTES[DEFAULT_THEME], choice: 'computer', setChoice: () => undefined })

const isTheme = (value: unknown): value is ThemeName => typeof value === 'string' && value in PALETTES

/**
 * The phone's theme: its own pick, or by default the computer's (ADR 0027). `desired` comes from
 * the computer's settings; the last one is remembered so the app opens in it.
 */
export function ThemeProvider({ desired, children }: { desired?: string; children: ReactNode }) {
  const [saved, setSaved] = useState<ThemeName>(DEFAULT_THEME)
  const [choice, setChoiceState] = useState<ThemeChoice>('computer')
  // The phone's pick wins, then the computer's choice; until it answers, the one remembered from last time.
  const name = choice !== 'computer' ? choice : isTheme(desired) ? desired : saved

  useEffect(() => {
    void secureStore.get(SAVED_KEY).then((value) => isTheme(value) && setSaved(value), () => undefined)
    void secureStore.get(CHOICE_KEY).then((value) => isTheme(value) && setChoiceState(value), () => undefined)
  }, [])

  useEffect(() => {
    if (isTheme(desired)) void secureStore.set(SAVED_KEY, desired).catch(() => undefined)
  }, [desired])

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next)
    void (next === 'computer' ? secureStore.remove(CHOICE_KEY) : secureStore.set(CHOICE_KEY, next)).catch(() => undefined)
  }, [])

  const value = useMemo(() => ({ name, colors: PALETTES[name], choice, setChoice }), [name, choice, setChoice])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export const useTheme = (): ThemeValue => useContext(ThemeContext)
