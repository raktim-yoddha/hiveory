import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal, type ITheme } from '@xterm/xterm'
import { api, subscribe } from '../../lib/api'
import { createDarkBackgroundFilter } from './dark-backgrounds'
import { adaptiveFontSize, FONT_SIZE, type LayoutNeeds, MIN_FONT_SIZE, smallerFontSize, visibleTop } from './terminal-fit'

/**
 * Keeps one xterm per agent instance alive outside React, so moving a pane
 * or switching Workspaces never loses terminal state. On first attach the
 * buffered output is replayed from main; offsets prevent duplicates.
 */

const ANSI_KEYS = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'
] as const

/** Terminal colors come from the design tokens (`--term-*` in tokens.css). */
const readTheme = (): ITheme => {
  const css = getComputedStyle(document.documentElement)
  const token = (name: string): string => css.getPropertyValue(`--term-${name}`).trim()
  // Over a wallpaper the pane's translucent surface shows through the terminal.
  const theme: ITheme = {
    background: 'wallpaper' in document.documentElement.dataset ? 'rgba(0, 0, 0, 0)' : token('bg'),
    foreground: token('fg'),
    cursor: token('cursor'),
    cursorAccent: token('bg'),
    selectionBackground: token('selection'),
    // The overview ruler only sizes the scrollbar; its 1px edge line would show as a stray border.
    overviewRulerBorder: 'rgba(0, 0, 0, 0)'
  }
  for (const key of ANSI_KEYS) (theme as Record<string, string>)[key] = token(key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`))
  return theme
}

/**
 * Smallest grid sent to a CLI: a narrower host is a transient layout state; a shorter pane keeps
 * MIN_ROWS and shows the rows around the cursor. Some TUIs crash on tiny grids (OpenCode's native renderer segfaults near 2×1), so the
 * floor matches main's `terminal.resize` validation.
 */
const MIN_COLS = 20
const MIN_ROWS = 5

const FONT = '"JetBrains Mono Variable", "Cascadia Mono", Consolas, monospace'
/** Matches the visible scrollbar (TerminalView.module.css), so fitting reserves no wider gutter. */
const SCROLLBAR_PX = 6

export { terminalMinWidth } from './terminal-fit'

interface Entry {
  term: Terminal
  fit: FitAddon
  element: HTMLDivElement
  opened: boolean
  /** Output offset already written; -1 until the snapshot arrives. */
  written: number
  pending: Array<{ data: string; offset: number }>
  lastSize: string
  /** The CLI's measured layout needs (columns and rows before its layout breaks). */
  needs: LayoutNeeds
  /** Rows the pane shows; fewer than the grid's when a TUI needs more rows than fit. */
  visibleRows: number
  /** The CLI hid its cursor (DECTCEM), so its position says nothing about where the user types. */
  cursorHidden: boolean
  /** The grid offset last applied, so renders only touch the DOM when it changes. */
  placed: string
  /** Output after near-black screen fills are dropped (stateful: chunks may split a sequence). */
  filter: (chunk: string) => string
}

const entries = new Map<string, Entry>()
let listening = false
let theme: ITheme | null = null
const fontReady = document.fonts?.load(`13px ${FONT}`).catch(() => undefined) ?? Promise.resolve()

const writeChunk = (entry: Entry, data: string, offset: number): void => {
  const end = offset + data.length
  if (end <= entry.written) return
  entry.term.write(entry.filter(offset >= entry.written ? data : data.slice(entry.written - offset)))
  entry.written = end
}

const ensureListener = (): void => {
  if (listening) return
  listening = true
  subscribe('terminal.data', ({ instanceId, data, offset }) => {
    const entry = entries.get(instanceId)
    if (!entry) return
    if (entry.written < 0) entry.pending.push({ data, offset })
    else writeChunk(entry, data, offset)
  })
}

// Clipboard goes through main (Electron's clipboard): no browser permission prompts, and
// dictation tools that paste via Ctrl+V (e.g. Wispr Flow) land reliably.
const copySelection = (term: Terminal): boolean => {
  const text = term.getSelection()
  if (!text) return false
  void api('clipboard.writeText', { text }).catch(() => undefined)
  return true
}

/** Raw Ctrl+V (lets a CLI read an image from the clipboard itself). */
const CTRL_V = String.fromCharCode(0x16)
/** ESC + CR: the newline-in-prompt sequence agent CLIs understand. */
const META_ENTER = String.fromCharCode(0x1b, 0x0d)

const send = (instanceId: string, data: string): void =>
  void api('terminal.write', { instanceId, data }).catch(() => undefined)

/** Pastes clipboard text; with no text (e.g. an image), forwards Ctrl+V so the CLI can read the clipboard itself. */
const pasteClipboard = (instanceId: string, term: Terminal): void =>
  void api('clipboard.readText')
    .then((text) => (text ? term.paste(text) : send(instanceId, CTRL_V)))
    .catch(() => send(instanceId, CTRL_V))

const create = (instanceId: string, needs: LayoutNeeds): Entry => {
  ensureListener()
  theme ??= readTheme()
  const term = new Terminal({
    fontFamily: FONT,
    fontSize: FONT_SIZE,
    lineHeight: 1.15,
    cursorBlink: true,
    scrollback: 10000,
    smoothScrollDuration: 0,
    // Wide glyphs (emoji, CJK) never overlap their neighbours.
    rescaleOverlappingGlyphs: true,
    allowProposedApi: true,
    allowTransparency: true,
      // The scrollbar's width; fitting reserves this (14px by default) beside the grid.
    overviewRuler: { width: SCROLLBAR_PX },
    theme
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  // Unicode 11 widths match what modern CLIs assume, so columns line up.
  term.loadAddon(new Unicode11Addon())
  term.unicode.activeVersion = '11'
  // While replayed output is parsed, xterm.js would answer the old capability queries in it
  // (device attributes, cursor position, modes, colors) and those replies would reach the
  // live CLI as typed input, long after it stopped waiting. TUIs with strict handshakes
  // (OpenCode/opentui) crash on such late, partial replies, so replies to the replay are
  // dropped. A keystroke in those few milliseconds is dropped too.
  let replaying = false
  term.onData((data) => {
    if (!replaying) send(instanceId, data)
  })
  term.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown') return true
    const key = event.key.toLowerCase()
    const mod = (event.ctrlKey || event.metaKey) && !event.altKey
    // Ctrl+C copies when there is a selection, otherwise it reaches the CLI as an interrupt.
    if (mod && key === 'c' && (event.shiftKey || term.hasSelection())) {
      event.preventDefault()
      copySelection(term)
      return false
    }
    if (mod && key === 'v') {
      event.preventDefault()
      pasteClipboard(instanceId, term)
      return false
    }
    // Shift+Enter inserts a newline in agent prompts (Claude Code, Codex…) instead of submitting.
    if (key === 'enter' && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault()
      send(instanceId, META_ENTER)
      return false
    }
    // Everything else — including Alt+<key> (sent as ESC-prefixed) and Ctrl+<key> — goes to the CLI.
    return true
  })
  const element = document.createElement('div')
  element.style.width = '100%'
  element.style.height = '100%'
  // Right-click: copy a selection, otherwise paste (terminal convention).
  element.addEventListener('contextmenu', (event) => {
    event.preventDefault()
    if (!copySelection(term)) pasteClipboard(instanceId, term)
    else term.clearSelection()
  })
  const entry: Entry = { term, fit, element, opened: false, written: -1, pending: [], lastSize: '', needs, visibleRows: 0, cursorHidden: false, placed: '', filter: createDarkBackgroundFilter() }
  entries.set(instanceId, entry)
  // Track cursor visibility (CSI ? 25 h / l) without consuming it: xterm still applies it.
  for (const final of ['h', 'l']) {
    term.parser.registerCsiHandler({ prefix: '?', final }, (params) => {
      if (params.includes(25)) entry.cursorHidden = final === 'l'
      return false
    })
  }
  // A grid taller than its pane follows the cursor as the CLI redraws.
  term.onRender(() => placeGrid(entry))

  void api('terminal.snapshot', { instanceId })
    .then((snapshot) => {
      replaying = true
      term.write(entry.filter(snapshot.data), () => {
        replaying = false
      })
      entry.written = snapshot.end
    })
    .catch(() => {
      entry.written = 0
    })
    .finally(() => {
      for (const chunk of entry.pending) writeChunk(entry, chunk.data, chunk.offset)
      entry.pending = []
    })
  return entry
}

/** GPU rendering: crisp text and gapless box/block glyphs. Falls back to DOM if the context is lost. */
const enableWebgl = (term: Terminal): void => {
  try {
    const webgl = new WebglAddon()
    webgl.onContextLoss(() => webgl.dispose())
    term.loadAddon(webgl)
  } catch {
    // DOM renderer keeps working.
  }
}

/**
 * Shows the part of a grid taller than its pane that matters: the bottom, or the rows around the
 * cursor when it would be out of view; the clipped edges fade out.
 */
const placeGrid = (entry: Entry): void => {
  const xterm = entry.term.element
  const screen = xterm?.querySelector<HTMLElement>('.xterm-screen')
  if (!xterm || !screen) return
  const { rows } = entry.term
  const visible = entry.visibleRows
  let placed = ''
  let clip = ''
  if (visible > 0 && rows > visible) {
    const cursor = entry.cursorHidden ? null : entry.term.buffer.active.cursorY
    const top = visibleTop(rows, visible, cursor)
    placed = `translateY(${(-top * screen.offsetHeight) / rows}px)`
    clip = top > 0 && top < rows - visible ? 'both' : top > 0 ? 'top' : 'bottom'
  }
  if (placed === entry.placed) return
  entry.placed = placed
  xterm.style.transform = placed
  if (clip) entry.element.dataset.clip = clip
  else delete entry.element.dataset.clip
}

/** Fits the terminal to its host and tells the PTY — only when the grid size actually changed. */
export const fitTerminal = (instanceId: string): void => {
  const entry = entries.get(instanceId)
  if (!entry?.opened || !entry.element.isConnected) return
  // A narrow pane zooms its font out so the CLI keeps a comfortable width — or the width it
  // needs — instead of squeezing its layout; a wide pane zooms back in. Sized from scratch on
  // every fit, so the same pane size always gives the same font and grid, and so the same UI.
  const { minColumns, minRows } = entry.needs
  const dpr = window.devicePixelRatio || 1
  const width = entry.element.clientWidth - SCROLLBAR_PX
  let size = width > 0 ? adaptiveFontSize(width, minColumns, dpr) : (entry.term.options.fontSize ?? FONT_SIZE)
  if (size !== entry.term.options.fontSize) entry.term.options.fontSize = size
  let proposed = entry.fit.proposeDimensions()
  // A full-screen TUI draws its parts over each other when it is too short: a short pane zooms out
  // one step — no further, so text stays readable…
  if (proposed && proposed.rows < minRows && size > MIN_FONT_SIZE) {
    size = smallerFontSize(size, dpr)
    entry.term.options.fontSize = size
    proposed = entry.fit.proposeDimensions()
  }
  if (!proposed || !Number.isFinite(proposed.cols) || !Number.isFinite(proposed.rows)) return
  entry.visibleRows = proposed.rows
  // A hidden, collapsing or minimizing host can report a sliver of width; never squeeze a TUI into it.
  if (proposed.cols < MIN_COLS) return placeGrid(entry)
  // …and it never gets fewer columns or rows than it needs, even when the window itself squeezes
  // the pane (OpenCode's renderer crashes on small, rapidly changing sizes): extra columns clip on
  // the right, extra rows are scrolled out of view around the cursor (placeGrid). Every CLI gets
  // at least MIN_ROWS, so a pane only a line or two tall still shows its prompt line.
  const cols = Math.max(proposed.cols, minColumns)
  const rows = Math.max(proposed.rows, minRows, MIN_ROWS)
  const key = `${cols}x${rows}`
  if (key !== entry.lastSize) {
    entry.lastSize = key
    entry.term.resize(cols, rows)
    void api('terminal.resize', { instanceId, cols, rows }).catch(() => undefined)
  }
  placeGrid(entry)
}

/** Mounts the instance's terminal into `host`. Returns a detach function. */
export const attachTerminal = (instanceId: string, host: HTMLElement, needs: LayoutNeeds): (() => void) => {
  const entry = entries.get(instanceId) ?? create(instanceId, needs)
  entry.needs = needs
  host.appendChild(entry.element)
  let cancelled = false
  void fontReady.then(() => {
    if (cancelled || !entry.element.isConnected) return
    if (!entry.opened) {
      entry.term.open(entry.element)
      enableWebgl(entry.term)
      entry.opened = true
    }
    fitTerminal(instanceId)
  })
  return () => {
    cancelled = true
    if (entry.element.parentElement === host) host.removeChild(entry.element)
  }
}

export const focusTerminal = (instanceId: string): void => entries.get(instanceId)?.term.focus()

/** Frees the terminal when its agent is closed. */
export const disposeTerminal = (instanceId: string): void => {
  const entry = entries.get(instanceId)
  if (!entry) return
  entries.delete(instanceId)
  entry.term.dispose()
  entry.element.remove()
}

/** Applies the current theme tokens to every open terminal (after a theme switch). */
export const refreshTerminalTheme = (): void => {
  theme = readTheme()
  for (const entry of entries.values()) entry.term.options.theme = theme
}
