import { describe, expect, it } from 'vitest'
import { adaptiveFontSize, COMFORT_COLUMNS, FONT_SIZE, MIN_FONT_SIZE, SQUEEZED_FONT_SIZE, terminalMinWidth } from './terminal-font'

/** The cell xterm draws for a font: its 0.6 em advance snapped down to whole device pixels. */
const cell = (font: number, dpr: number): number => Math.floor(font * 0.6 * dpr) / dpr
const columns = (width: number, font: number, dpr: number): number => Math.floor(width / cell(font, dpr))

describe('adaptive terminal font', () => {
  it('keeps the full size when the pane already has the comfortable columns', () => {
    expect(adaptiveFontSize(800, 0, 1)).toBe(FONT_SIZE)
    expect(adaptiveFontSize(COMFORT_COLUMNS * 7, 0, 1)).toBe(FONT_SIZE)
  })

  it('zooms out until the columns fit, at every display scale', () => {
    for (const dpr of [1, 1.25, 1.5, 2]) {
      for (const width of [260, 300, 340]) {
        expect(adaptiveFontSize(width, 0, dpr)).toBeLessThan(FONT_SIZE)
        expect(columns(width, adaptiveFontSize(width, 0, dpr), dpr)).toBeGreaterThanOrEqual(COMFORT_COLUMNS)
        expect(columns(width, adaptiveFontSize(width, 60, dpr), dpr)).toBeGreaterThanOrEqual(60)
      }
    }
  })

  it('fills its pixel cell instead of squeezing a bigger glyph into it', () => {
    // 300px / 50 columns = 6px cells at 100%: 10.83px glyphs advance 6.5px, snapping to 6.
    const size = adaptiveFontSize(300, 0, 1)
    expect(cell(size, 1)).toBe(6)
    expect(size * 0.6 - 6).toBeLessThan(1)
  })

  it('stops at the smallest font; only a CLI that needs its columns goes smaller', () => {
    expect(adaptiveFontSize(100, 0, 1)).toBe(MIN_FONT_SIZE)
    expect(adaptiveFontSize(100, 60, 1)).toBe(SQUEEZED_FONT_SIZE)
    // A squeezed pane still gets all 60 columns where the smallest font alone would clip them.
    expect(columns(230, MIN_FONT_SIZE, 1.25)).toBeLessThan(60)
    expect(columns(230, adaptiveFontSize(230, 60, 1.25), 1.25)).toBeGreaterThanOrEqual(60)
  })

  it('locks a pane wide enough for the CLI minimum at the smallest font', () => {
    expect(terminalMinWidth(60)).toBeGreaterThan(terminalMinWidth(50))
    expect(columns(terminalMinWidth(60) - 24, MIN_FONT_SIZE, 1)).toBeGreaterThanOrEqual(60)
  })
})
