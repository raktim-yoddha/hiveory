import { Text as RNText, type TextProps as RNTextProps } from 'react-native'
import { font, useTheme, type Palette } from '../theme'

const VARIANTS = {
  display: { fontSize: font.size.display, fontWeight: font.weight.bold, letterSpacing: -0.4 },
  title: { fontSize: font.size.title, fontWeight: font.weight.semibold, letterSpacing: -0.2 },
  lead: { fontSize: font.size.lead, fontWeight: font.weight.semibold },
  body: { fontSize: font.size.body, fontWeight: font.weight.regular },
  label: { fontSize: font.size.label, fontWeight: font.weight.medium },
  caption: { fontSize: font.size.caption, fontWeight: font.weight.regular },
  overline: { fontSize: font.size.caption, fontWeight: font.weight.semibold, letterSpacing: 0.8, textTransform: 'uppercase' },
  mono: { fontSize: font.size.label, fontFamily: font.mono }
} as const

type Tone = 'default' | 'secondary' | 'muted' | 'accent' | 'brand' | 'danger' | 'working' | 'waiting' | 'contrast'

const toneColor = (c: Palette, tone: Tone): string =>
  ({
    default: c.text,
    secondary: c.textSecondary,
    muted: c.textMuted,
    accent: c.accent,
    brand: c.brand,
    danger: c.danger,
    working: c.working,
    waiting: c.waiting,
    contrast: c.accentContrast
  })[tone]

export interface TextProps extends RNTextProps {
  variant?: keyof typeof VARIANTS
  tone?: Tone
}

/** Every piece of text in the app: one type scale, theme colors only. */
export function Text({ variant = 'body', tone = 'default', style, ...rest }: TextProps) {
  const { colors } = useTheme()
  return <RNText {...rest} style={[VARIANTS[variant], { color: toneColor(colors, tone) }, style]} />
}
