import { describe, expect, it } from 'vitest'
import { THEME_COLOR, themeKind, themeSlug, themeTokens } from './vscode-theme'

describe('themeTokens', () => {
  it('maps VS Code colors onto Hiveory tokens', () => {
    const { tokens, chrome } = themeTokens(
      {
        'editor.background': '#282a36',
        foreground: '#f8f8f2',
        'activityBar.background': '#343746',
        'button.background': '#44475a',
        'button.foreground': '#f8f8f2',
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
    expect(tokens['color-accent']).toBe('#44475a')
    expect(tokens['color-accent-contrast']).toBe('#f8f8f2')
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
        { scope: 'keyword', settings: { foreground: '#111111' } },
        { scope: ['keyword.control', 'storage'], settings: { foreground: '#222222' } },
        { scope: 'string, string.quoted', settings: { foreground: '#333333' } },
        { scope: 'source comment', settings: { foreground: '#444444' } }
      ],
      'dark'
    )
    expect(tokens['syntax-keyword']).toBe('#222222')
    expect(tokens['syntax-string']).toBe('#333333')
    // Descendant selectors are skipped: the default comment color applies.
    expect(tokens['syntax-comment']).toBeUndefined()
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
