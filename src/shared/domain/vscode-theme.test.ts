import { describe, expect, it } from 'vitest'
import { THEME_COLOR, themeKind, themeSlug, themeTokens } from './vscode-theme'

describe('themeTokens', () => {
  it('maps VS Code colors onto Hiveory tokens', () => {
    const { tokens, chrome } = themeTokens(
      {
        'editor.background': '#282a36',
        foreground: '#f8f8f2',
        'activityBar.background': '#343746',
        'button.background': '#bd93f9',
        'button.foreground': '#282a36',
        'terminal.ansiRed': '#ff5555',
        'terminal.ansiBrightGreen': '#69ff94',
        'editor.selectionBackground': '#44475a80'
      },
      [],
      'dark'
    )
    expect(tokens['base-surface']).toBe('#282a36')
    expect(tokens['term-bg']).toBe('#282a36')
    expect(tokens['color-bg']).toBe('#343746')
    expect(tokens['color-text']).toBe('#f8f8f2')
    expect(tokens['color-accent']).toBe('#bd93f9')
    expect(tokens['color-accent-contrast']).toBe('#282a36')
    expect(tokens['term-red']).toBe('#ff5555')
    expect(tokens['term-bright-green']).toBe('#69ff94')
    expect(tokens['term-selection']).toBe('#44475a80')
    expect(chrome.background).toBe('#343746')
  })

  it('composites translucent surface colors so dialogs stay solid', () => {
    const { tokens } = themeTokens({ 'editor.background': '#000000', 'list.hoverBackground': '#ffffff80' }, [], 'dark')
    expect(tokens['base-surface-hover']).toBe('#808080')
  })

  it('derives everything for an empty theme, and only ever emits hex colors', () => {
    for (const kind of ['dark', 'light'] as const) {
      const { tokens, chrome } = themeTokens({ 'editor.background': 'red; } body { display: none' }, [], kind)
      expect(Object.keys(tokens).length).toBeGreaterThan(50)
      for (const value of [...Object.values(tokens), chrome.background, chrome.symbols]) expect(value).toMatch(THEME_COLOR)
    }
    expect(themeTokens({}, [], 'light').tokens['base-surface']).toBe('#ffffff')
  })

  it('ignores transparent borders and falls back to a visible one', () => {
    const { tokens } = themeTokens({ 'editor.background': '#1e1e1e', 'panel.border': '#00000000' }, [], 'dark')
    expect(tokens['color-border']).not.toBe('#1e1e1e')
  })

  it('reads syntax colors from tokenColors, most specific scope winning', () => {
    const { tokens } = themeTokens(
      { 'editor.background': '#1e1e1e' },
      [
        { scope: 'keyword', settings: { foreground: '#569cd6' } },
        { scope: ['keyword.control', 'storage'], settings: { foreground: '#c586c0' } },
        { scope: 'string, string.quoted', settings: { foreground: '#ce9178' } },
        { scope: 'source comment', settings: { foreground: '#6a9955' } }
      ],
      'dark'
    )
    expect(tokens['syntax-keyword']).toBe('#c586c0')
    expect(tokens['syntax-string']).toBe('#ce9178')
    // Descendant selectors are skipped: the default comment color applies.
    expect(tokens['syntax-comment']).toBeUndefined()
  })
})

describe('readable colors (ADR 0038)', () => {
  const ratio = (a: string, b: string): number => {
    const l = (h: string): number => {
      const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!
    }
    const [x, y] = [l(a), l(b)].sort((m, n) => n - m) as [number, number]
    return (x + 0.05) / (y + 0.05)
  }

  it('skips an accent that would vanish against the panel, for the next theme color that reads', () => {
    // One Dark Pro: a gray button color, a blue link color.
    const { tokens } = themeTokens({ 'editor.background': '#282c34', 'button.background': '#404754', 'textLink.foreground': '#61afef' }, [], 'dark')
    expect(tokens['color-accent']).toBe('#61afef')
    expect(ratio(tokens['color-accent-contrast']!, tokens['color-accent']!)).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps text, status and syntax readable on light and dark themes', () => {
    for (const [bg, fg, kind] of [['#eff1f5', '#cccccc', 'light'], ['#1e1e1e', '#333333', 'dark']] as const) {
      const { tokens } = themeTokens({ 'editor.background': bg, descriptionForeground: fg, 'terminal.foreground': fg, 'button.background': bg, 'terminal.ansiGreen': fg }, [{ scope: 'string', settings: { foreground: fg } }], kind)
      expect(ratio(tokens['color-accent']!, bg)).toBeGreaterThanOrEqual(3)
      expect(ratio(tokens['color-text-muted']!, bg)).toBeGreaterThanOrEqual(3.5)
      expect(ratio(tokens['term-fg']!, bg)).toBeGreaterThanOrEqual(4.5)
      expect(ratio(tokens['color-working']!, bg)).toBeGreaterThanOrEqual(3)
      expect(ratio(tokens['syntax-string']!, bg)).toBeGreaterThanOrEqual(3)
    }
  })
})

describe('helpers', () => {
  it('reads the theme kind from uiTheme', () => {
    expect(themeKind('vs')).toBe('light')
    expect(themeKind('hc-light')).toBe('light')
    expect(themeKind('vs-dark')).toBe('dark')
    expect(themeKind('hc-black')).toBe('dark')
    expect(themeKind(undefined)).toBe('dark')
  })

  it('slugs labels', () => {
    expect(themeSlug('One Dark Pro (Flat)')).toBe('one-dark-pro-flat')
    expect(themeSlug('★')).toBe('theme')
  })
})
