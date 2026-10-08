import { Platform } from 'react-native'
import { PALETTES } from './palettes'

export type ThemeName = keyof typeof PALETTES
export type Palette = (typeof PALETTES)[ThemeName]
export const THEME_NAMES = Object.keys(PALETTES) as ThemeName[]
/** The phone opens in Silver until the user picks another theme (the desktop's default stays Dark). */
export const DEFAULT_THEME: ThemeName = 'silver'

/**
 * The phone's scale (ADR 0027). Colors are the desktop's own; sizes are the
 * desktop's rhythm made for thumbs: the same spacing steps, softer corners,
 * readable type and 44-point touch targets (Apple HIG / Material minimums).
 */
export const space = { 1: 2, 2: 4, 3: 6, 4: 8, 5: 10, 6: 12, 7: 16, 8: 20, 9: 24, 10: 32, 11: 48 } as const
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const
export const touch = 44
/** The air between surfaces (design.md "Surfaces Need Air"), and a screen's side margin. */
export const gutter = space[5]
export const pageX = space[7]

export const font = {
  size: { caption: 12, label: 13, body: 15, lead: 17, title: 20, display: 28 },
  weight: { regular: '400', medium: '500', semibold: '600', bold: '700' },
  mono: Platform.select({ ios: 'Menlo', default: 'monospace' })
} as const

export const motion = { fast: 110, base: 170, slow: 240 } as const
