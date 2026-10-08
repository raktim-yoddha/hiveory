/**
 * Adaptive terminal font: a narrow pane zooms its text out instead of squeezing the CLI into
 * a few columns, so welcome boxes, logos and footers keep their layout in small panes.
 */

export const FONT_SIZE = 13
/** Smallest font a narrow pane zooms out to. */
export const MIN_FONT_SIZE = 8
/**
 * Smallest font for a CLI whose layout breaks below its `minColumns`, when the window squeezes its
 * pane under the width that minimum needs: tiny text beats a clipped logo and cut-off footer.
 */
export const SQUEEZED_FONT_SIZE = 6
/**
 * Columns every terminal zooms out toward before giving up width: measured, agent CLIs
 * (Claude Code, Codex, Kimi…) show their whole welcome header and prompt from here.
 */
export const COMFORT_COLUMNS = 50
/** A monospace cell's width per px of font size (JetBrains Mono's advance is 600/1000 em). */
const CELL_WIDTH_PER_PX = 0.6
/** Pane width around the grid: the terminal's insets, the pane border and the scrollbar. */
const TERMINAL_CHROME_PX = 24

/** xterm snaps a cell to whole device pixels, rounding the glyph's advance down. */
const cellWidth = (fontSize: number, dpr: number): number => Math.floor(fontSize * CELL_WIDTH_PER_PX * dpr) / dpr

/**
 * The font size that fits a CLI's columns into `width` CSS px — the comfortable width, or its own
 * `minColumns` when it needs more: full size when they already fit, otherwise the widest
 * whole-device-pixel cell that fits, with a font whose glyphs fill that cell (half a device pixel
 * over, so it snaps to it) rather than one squeezed into a smaller cell.
 */
export const adaptiveFontSize = (width: number, minColumns: number, dpr: number): number => {
  const target = Math.max(COMFORT_COLUMNS, minColumns)
  if (width / cellWidth(FONT_SIZE, dpr) >= target) return FONT_SIZE
  const floor = minColumns ? SQUEEZED_FONT_SIZE : MIN_FONT_SIZE
  const cell = Math.max(Math.floor((width / target) * dpr) / dpr, cellWidth(floor, dpr))
  return Math.min(FONT_SIZE, Math.max(floor, (cell + 0.5 / dpr) / CELL_WIDTH_PER_PX))
}

/** Narrowest pane that still gives a CLI `minColumns` at the smallest font: the layout won't drag below it. */
export const terminalMinWidth = (minColumns: number): number =>
  Math.ceil(minColumns * MIN_FONT_SIZE * CELL_WIDTH_PER_PX) + TERMINAL_CHROME_PX
