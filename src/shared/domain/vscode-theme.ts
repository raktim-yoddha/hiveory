/**
 * VS Code color themes in Hiveory (ADR 0034). A theme's `colors` and
 * `tokenColors` are mapped onto Hiveory's own design tokens (tokens.css), so
 * every surface, the terminals and the editor follow it without a single
 * component knowing VS Code exists. Only colors cross over: spacing, type and
 * motion stay Hiveory's, and the wallpaper transparency still applies on top.
 */

export type ThemeKind = 'dark' | 'light'

/** One color theme from an installed extension. */
export interface VsCodeTheme {
  /** `<extension id>/<slug>`: what `settings.vscodeTheme` stores. */
  id: string
  label: string
  kind: ThemeKind
  /** CSS custom property (without `--`) → `#rrggbb` / `#rrggbbaa`. */
  tokens: Record<string, string>
  /** Native title-bar overlay (it cannot read CSS). */
  chrome: { background: string; symbols: string }
}

/** An installed theme extension (Open VSX `namespace.name`). */
export interface VsCodeThemeExtension {
  id: string
  displayName: string
  publisher: string
  version: string
  themes: VsCodeTheme[]
  /** Which `themeTokens` mapped it (`THEME_MAPPING`); older ones are mapped again (ADR 0038). */
  mapping?: number
}

/** Bumped when `themeTokens` changes what it produces, so installed themes are mapped again. */
export const THEME_MAPPING = 2

/** A search result from the Open VSX theme catalog. */
export interface ThemeListing {
  id: string
  namespace: string
  name: string
  displayName: string
  description: string
  version: string
  downloads: number
  icon: string | null
}

export const THEME_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/
export const THEME_EXTENSION_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,255}$/
export const VSCODE_THEME_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,255}\/[a-z0-9-]{1,80}$/
/** Every value the mapper emits; the renderer re-checks before writing CSS. */
export const THEME_COLOR = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/

/** A theme rule from `tokenColors`. */
export interface TokenColorRule {
  scope?: string | string[]
  settings?: { foreground?: string; fontStyle?: string }
}

type Rgba = [number, number, number, number]

const parse = (value: unknown): Rgba | null => {
  if (typeof value !== 'string') return null
  const m = /^#([0-9a-f]{3,8})$/i.exec(value.trim())
  if (!m || ![3, 4, 6, 8].includes(m[1]!.length)) return null
  let hex = m[1]!
  if (hex.length <= 4) hex = [...hex].map((c) => c + c).join('')
  const n = (i: number): number => parseInt(hex.slice(i, i + 2), 16)
  return [n(0), n(2), n(4), hex.length === 8 ? n(6) / 255 : 1]
}

const hex = ([r, g, b, a]: Rgba): string => {
  const h = (n: number): string => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}${a < 1 ? h(a * 255) : ''}`
}

/** `a` over `b` by `t` (0 = b, 1 = a), opaque. */
const mix = (a: Rgba, b: Rgba, t: number): Rgba => [a[0] * t + b[0] * (1 - t), a[1] * t + b[1] * (1 - t), a[2] * t + b[2] * (1 - t), 1]
/** A translucent color composited over an opaque one. */
const over = (c: Rgba, base: Rgba): Rgba => mix(c, base, c[3])
const alpha = (c: Rgba, a: number): Rgba => [c[0], c[1], c[2], a]
/** WCAG relative luminance and contrast ratio (1–21). */
const relative = ([r, g, b]: Rgba): number => {
  const f = (v: number): number => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const contrastRatio = (a: Rgba, b: Rgba): number => {
  const [x, y] = [relative(a), relative(b)].sort((m, n) => n - m) as [number, number]
  return (x + 0.05) / (y + 0.05)
}
/**
 * `c` moved toward `toward` just far enough to read at `min`:1 against `bg`. Themes pick colors for
 * VS Code's own surfaces; Hiveory also uses them as text (accent labels, status words, the mark), so
 * a button color that is nearly the panel's color would vanish (ADR 0038).
 */
const readable = (c: Rgba, bg: Rgba, min: number, toward: Rgba): Rgba => {
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const m = mix(toward, c, t)
    if (contrastRatio(m, bg) >= min) return m
  }
  return toward
}
const distance = (a: Rgba, b: Rgba): number => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])
const BLACK: Rgba = [0, 0, 0, 1]
const WHITE: Rgba = [255, 255, 255, 1]

/** VS Code's own terminal colors, for themes that don't set them. */
const ANSI_DEFAULTS: Record<ThemeKind, string[]> = {
  dark: ['#000000', '#cd3131', '#0dbc79', '#e5e510', '#2472c8', '#bc3fbc', '#11a8cd', '#e5e5e5', '#666666', '#f14c4c', '#23d18b', '#f5f543', '#3b8eea', '#d670d6', '#29b8db', '#e5e5e5'],
  light: ['#000000', '#cd3131', '#00bc00', '#949800', '#0451a5', '#bc05bc', '#0598bc', '#555555', '#666666', '#cd3131', '#14ce14', '#b5ba00', '#0451a5', '#bc05bc', '#0598bc', '#a5a5a5']
}
const ANSI_NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']
const ansiKey = (i: number): [string, string] => {
  const name = ANSI_NAMES[i % 8]!
  return i < 8 ? [`terminal.ansi${name[0]!.toUpperCase()}${name.slice(1)}`, `term-${name}`] : [`terminal.ansiBright${name[0]!.toUpperCase()}${name.slice(1)}`, `term-bright-${name}`]
}

/** Hiveory's status colors where a theme has no opinion (readable on its kind of background). */
const STATUS_DEFAULTS: Record<ThemeKind, { working: string; waiting: string; danger: string }> = {
  dark: { working: '#6fcf8e', waiting: '#e8b04f', danger: '#e6806c' },
  light: { working: '#1a7f37', waiting: '#9a6700', danger: '#cf222e' }
}

/** Syntax token → TextMate scopes, most specific first. */
const SYNTAX: Record<string, string[]> = {
  keyword: ['keyword.control', 'keyword', 'storage.type', 'storage'],
  string: ['string.quoted', 'string'],
  number: ['constant.numeric', 'constant.language', 'constant'],
  function: ['entity.name.function', 'support.function'],
  type: ['entity.name.type', 'entity.name.class', 'support.type', 'support.class'],
  property: ['variable.other.property', 'support.type.property-name', 'variable.other.object.property', 'meta.object-literal.key'],
  tag: ['entity.name.tag', 'markup.heading'],
  comment: ['comment'],
  link: ['markup.underline.link', 'string.other.link']
}

/** The foreground of the most specific rule matching `scope` (descendant selectors are ignored). */
const scopeColor = (rules: TokenColorRule[], scope: string): Rgba | null => {
  let best: Rgba | null = null
  let bestLength = -1
  for (const rule of rules) {
    const color = parse(rule.settings?.foreground)
    if (!color) continue
    const selectors = (Array.isArray(rule.scope) ? rule.scope : typeof rule.scope === 'string' ? rule.scope.split(',') : []).map((s) => String(s).trim())
    for (const s of selectors) {
      if (!s || s.includes(' ')) continue
      // Later rules win ties, as in VS Code.
      if ((scope === s || scope.startsWith(`${s}.`)) && s.length >= bestLength) {
        best = color
        bestLength = s.length
      }
    }
  }
  return best
}

/** `uiTheme` from package.json (or `type` in the theme file) → dark/light. */
export const themeKind = (uiTheme: unknown): ThemeKind => (uiTheme === 'vs' || uiTheme === 'hc-light' || uiTheme === 'light' ? 'light' : 'dark')

/** Maps a VS Code theme onto Hiveory's design tokens. Unknown or malformed colors fall back to derived ones. */
export const themeTokens = (colors: Record<string, unknown>, tokenColors: TokenColorRule[], kind: ThemeKind): Pick<VsCodeTheme, 'tokens' | 'chrome'> => {
  const dark = kind === 'dark'
  const get = (...keys: string[]): Rgba | null => {
    for (const key of keys) {
      const c = parse(colors[key])
      if (c) return c
    }
    return null
  }
  const surface = over(get('editor.background') ?? parse(dark ? '#1e1e1e' : '#ffffff')!, dark ? BLACK : WHITE)
  const text = over(get('foreground', 'editor.foreground') ?? parse(dark ? '#cccccc' : '#3b3b3b')!, surface)
  /** A theme color composited over `base`, unless missing, fully transparent or invisible against it. */
  const solid = (base: Rgba, ...keys: string[]): Rgba | null => {
    const c = get(...keys)
    if (!c || c[3] === 0) return null
    const s = over(c, base)
    return distance(s, base) < 4 ? null : s
  }
  const lift = (t: number): Rgba => mix(text, surface, t)

  // The window behind the panes: VS Code's outer chrome, or a step darker than the editor.
  const bg = solid(surface, 'activityBar.background', 'titleBar.activeBackground', 'sideBar.background') ?? mix(BLACK, surface, dark ? 0.3 : 0.05)
  const raised = solid(surface, 'editorWidget.background', 'quickInput.background', 'dropdown.background', 'menu.background') ?? lift(dark ? 0.05 : 0.04)
  const hover = solid(surface, 'list.hoverBackground') ?? lift(0.07)
  const active = solid(surface, 'list.inactiveSelectionBackground', 'list.activeSelectionBackground') ?? lift(0.12)
  // Wells and inputs sit a shade below the panel in both kinds (a white input on a white panel would vanish).
  const inset = solid(surface, 'input.background') ?? mix(BLACK, surface, dark ? 0.25 : 0.035)
  const header = solid(surface, 'editorGroupHeader.tabsBackground', 'tab.inactiveBackground') ?? mix(bg, surface, 0.5)
  const border = solid(surface, 'panel.border', 'editorGroup.border', 'sideBar.border', 'contrastBorder') ?? lift(0.14)
  // Away from the background: toward white on a dark theme, black on a light one (keeps the hue).
  const far = dark ? WHITE : BLACK
  // The accent is a fill (buttons) and a text color (labels, selection): the first theme color that
  // reads against the panel, so a gray button color (One Dark Pro) gives way to its link blue.
  const accentCandidates = ['button.background', 'textLink.foreground', 'focusBorder', 'activityBarBadge.background', 'terminal.ansiBlue']
    .map((key) => get(key))
    .filter((c): c is Rgba => Boolean(c && c[3] > 0))
    .map((c) => over(c, surface))
  const accent =
    accentCandidates.find((c) => contrastRatio(c, surface) >= 3) ??
    readable(accentCandidates[0] ?? parse(dark ? '#0e639c' : '#005fb8')!, surface, 3, far)
  const buttonText = over(get('button.foreground') ?? WHITE, accent)
  const accentContrast = contrastRatio(buttonText, accent) >= 4.5 ? buttonText : contrastRatio(BLACK, accent) > contrastRatio(WHITE, accent) ? BLACK : WHITE
  const brand = readable(over(get('textLink.foreground', 'focusBorder') ?? accent, surface), surface, 3, far)
  const focus = readable(over(get('focusBorder') ?? accent, surface), surface, 3, far)
  const muted = readable(over(get('descriptionForeground') ?? lift(0.55), surface), surface, 3.5, text)
  const defaults = STATUS_DEFAULTS[kind]
  const status = (fallback: string, ...keys: string[]): Rgba => readable(over(get(...keys) ?? parse(fallback)!, surface), surface, 3, far)
  const working = status(defaults.working, 'gitDecoration.addedResourceForeground', 'terminal.ansiGreen')
  const waiting = status(defaults.waiting, 'editorWarning.foreground', 'list.warningForeground', 'terminal.ansiYellow')
  const danger = status(defaults.danger, 'errorForeground', 'editorError.foreground', 'terminal.ansiRed')
  const shadow = dark ? 0.6 : 0.16

  const t: Record<string, Rgba> = {
    'color-bg': bg,
    'base-surface': surface,
    'base-surface-top': header,
    'base-surface-raised': raised,
    'base-surface-hover': hover,
    'base-surface-active': active,
    'base-surface-inset': inset,
    'base-pane-header': header,
    'color-pane-header-edge': border,
    'color-overlay': alpha(dark ? BLACK : mix(BLACK, surface, 0.6), dark ? 0.66 : 0.32),
    'color-glass': alpha(raised, 0.9),
    'color-border': border,
    'color-border-strong': mix(text, border, 0.16),
    'color-text': text,
    'color-text-secondary': readable(lift(0.78), surface, 4.5, text),
    'color-text-muted': muted,
    'color-text-faint': lift(0.34),
    'color-accent': accent,
    'color-accent-hover': accent === accentCandidates[0] ? over(get('button.hoverBackground') ?? mix(text, accent, 0.15), surface) : mix(text, accent, 0.15),
    'color-accent-contrast': accentContrast,
    'color-bronze': brand,
    'color-bronze-soft': alpha(brand, 0.15),
    'color-focus': focus,
    'color-idle': muted,
    'color-working': working,
    'color-success': working,
    'color-waiting': waiting,
    'color-warning': waiting,
    'color-danger': danger,
    'color-working-soft': alpha(working, 0.13),
    'color-waiting-soft': alpha(waiting, 0.14),
    'color-waiting-edge': alpha(waiting, 0.42),
    'color-danger-soft': alpha(danger, 0.13),
    'color-drop': alpha(accent, 0.08),
    'color-drop-border': alpha(accent, 0.5),
    'term-bg': surface,
    'term-fg': readable(over(get('terminal.foreground') ?? text, surface), surface, 4.5, text),
    'term-cursor': over(get('terminalCursor.foreground', 'editorCursor.foreground') ?? accent, surface),
    'term-selection': get('terminal.selectionBackground', 'editor.selectionBackground') ?? alpha(accent, 0.3)
  }
  for (let i = 0; i < 16; i++) {
    const [key, token] = ansiKey(i)
    t[token] = over(get(key) ?? parse(ANSI_DEFAULTS[kind][i])!, surface)
  }
  for (const [name, scopes] of Object.entries(SYNTAX)) {
    const c = scopes.map((s) => scopeColor(tokenColors, s)).find(Boolean)
    if (c) t[`syntax-${name}`] = readable(over(c, surface), surface, name === 'comment' ? 2.5 : 3, far)
  }

  const tokens = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, hex(v)]))
  // Shadows are the one non-color token that must follow the theme's lightness.
  return {
    tokens: { ...tokens, 'shadow-tint': hex(alpha(BLACK, shadow)) },
    chrome: { background: hex(bg), symbols: hex(lift(0.78)) }
  }
}

/**
 * Tokens stored by an older mapping, made readable without the theme file: every text-like color
 * reaches the contrast `themeTokens` gives new installs. Until the theme is mapped again it keeps
 * its own accent hue, lightened or darkened as needed.
 */
export const readableTokens = (tokens: Record<string, string>, kind: ThemeKind): Record<string, string> => {
  const surface = parse(tokens['base-surface'])
  const text = parse(tokens['color-text'])
  if (!surface || !text) return tokens
  const far = kind === 'dark' ? WHITE : BLACK
  const out = { ...tokens }
  const fix = (key: string, min: number, toward: Rgba): void => {
    const c = parse(out[key])
    if (c) out[key] = hex(readable(c, surface, min, toward))
  }
  for (const key of ['color-accent', 'color-bronze', 'color-focus', 'color-working', 'color-success', 'color-waiting', 'color-warning', 'color-danger']) fix(key, 3, far)
  fix('color-text-muted', 3.5, text)
  fix('color-text-secondary', 4.5, text)
  fix('term-fg', 4.5, text)
  for (const key of Object.keys(out)) if (key.startsWith('syntax-')) fix(key, key === 'syntax-comment' ? 2.5 : 3, far)
  const accent = parse(out['color-accent'])
  const label = parse(out['color-accent-contrast'])
  if (accent && (!label || contrastRatio(label, accent) < 4.5)) out['color-accent-contrast'] = hex(contrastRatio(BLACK, accent) > contrastRatio(WHITE, accent) ? BLACK : WHITE)
  return out
}

export const themeSlug = (label: string): string =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'theme'
