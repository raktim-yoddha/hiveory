import { describe, expect, it } from 'vitest'
import { adaptiveFontSize, COMFORT_COLUMNS, FONT_SIZE, MIN_FONT_SIZE, smallerFontSize, SQUEEZED_FONT_SIZE, terminalMinWidth, visibleTop } from './terminal-fit'

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

  it('steps a short pane down one whole-pixel cell at a time, stopping at the smallest font', () => {
    for (const dpr of [1, 1.25, 2]) {
      let size = FONT_SIZE
      const seen = [size]
      while (size > MIN_FONT_SIZE) {
        const next = smallerFontSize(size, dpr)
        expect(next).toBeLessThan(size)
        if (next > MIN_FONT_SIZE) expect(cell(next, dpr)).toBeCloseTo(cell(size, dpr) - 1 / dpr)
        size = next
        seen.push(size)
      }
      expect(seen.at(-1)).toBe(MIN_FONT_SIZE)
    }
  })
})

describe('the visible part of a grid taller than its pane', () => {
  it('shows the whole grid when it fits', () => {
    expect(visibleTop(20, 20, 3)).toBe(0)
    expect(visibleTop(20, 30, null)).toBe(0)
  })

  it('shows the bottom, where prompts and footers are, when the cursor is there or hidden', () => {
    expect(visibleTop(28, 16, 26)).toBe(12)
    expect(visibleTop(28, 16, null)).toBe(12)
  })

  it('scrolls up to a home screen prompt the bottom would hide, keeping its top edge', () => {
    // Kilo's home screen at 28 rows types on row 10; 16 visible rows start at its prompt box.
    expect(visibleTop(28, 16, 10)).toBe(9)
    expect(visibleTop(28, 16, 1)).toBe(0)
  })

  it('keeps the cursor line itself in a pane only a line tall', () => {
    expect(visibleTop(5, 1, 1)).toBe(1)
  })

  it('is the same for the same size and cursor, whatever came before', () => {
    expect(visibleTop(28, 16, 10)).toBe(visibleTop(28, 16, 10))
  })
})
