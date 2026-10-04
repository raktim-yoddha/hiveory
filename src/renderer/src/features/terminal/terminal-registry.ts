import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal, type ITheme } from '@xterm/xterm'
import { api, subscribe } from '../../lib/api'

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
  const theme: ITheme = {
    background: token('bg'),
    foreground: token('fg'),
    cursor: token('cursor'),
    cursorAccent: token('bg'),
    selectionBackground: token('selection')
  }
  for (const key of ANSI_KEYS) (theme as Record<string, string>)[key] = token(key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`))
  return theme
}

const FONT = '"JetBrains Mono Variable", "Cascadia Mono", Consolas, monospace'

interface Entry {
  term: Terminal
  fit: FitAddon
  element: HTMLDivElement
  opened: boolean
  /** Output offset already written; -1 until the snapshot arrives. */
  written: number
  pending: Array<{ data: string; offset: number }>
  lastSize: string
}

const entries = new Map<string, Entry>()
let listening = false
let theme: ITheme | null = null
const fontReady = document.fonts?.load(`13px ${FONT}`).catch(() => undefined) ?? Promise.resolve()

const writeChunk = (entry: Entry, data: string, offset: number): void => {
  const end = offset + data.length
  if (end <= entry.written) return
  entry.term.write(offset >= entry.written ? data : data.slice(entry.written - offset))
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

const copySelection = (term: Terminal): boolean => {
  const text = term.getSelection()
  if (!text) return false
  void navigator.clipboard.writeText(text).catch(() => undefined)
  return true
}

const create = (instanceId: string): Entry => {
  ensureListener()
  theme ??= readTheme()
  const term = new Terminal({
    fontFamily: FONT,
    fontSize: 13,
    lineHeight: 1.15,
    cursorBlink: true,
    scrollback: 10000,
    smoothScrollDuration: 0,
    // Wide glyphs (emoji, CJK) never overlap their neighbours.
    rescaleOverlappingGlyphs: true,
    allowProposedApi: true,
    theme
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  // Unicode 11 widths match what modern CLIs assume, so columns line up.
  term.loadAddon(new Unicode11Addon())
  term.unicode.activeVersion = '11'
  term.onData((data) => void api('terminal.write', { instanceId, data }).catch(() => undefined))
  term.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown') return true
    const mod = event.ctrlKey || event.metaKey
    // Ctrl+C copies when there is a selection, otherwise it reaches the CLI as an interrupt.
    if (mod && event.key.toLowerCase() === 'c' && (event.shiftKey || term.hasSelection())) {
      return !copySelection(term)
    }
    if (mod && event.key.toLowerCase() === 'v') {
      event.preventDefault()
      void navigator.clipboard
        .readText()
        .then((text) => text && term.paste(text))
        .catch(() => undefined)
      return false
    }
    return true
  })
  const element = document.createElement('div')
  element.style.width = '100%'
  element.style.height = '100%'
  const entry: Entry = { term, fit, element, opened: false, written: -1, pending: [], lastSize: '' }
  entries.set(instanceId, entry)

  void api('terminal.snapshot', { instanceId })
    .then((snapshot) => {
      term.write(snapshot.data)
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

/** Fits the terminal to its host and tells the PTY — only when the grid size actually changed. */
export const fitTerminal = (instanceId: string): void => {
  const entry = entries.get(instanceId)
  if (!entry?.opened || !entry.element.isConnected) return
  const proposed = entry.fit.proposeDimensions()
  if (!proposed || !Number.isFinite(proposed.cols) || proposed.cols < 2 || proposed.rows < 2) return
  const key = `${proposed.cols}x${proposed.rows}`
  if (key === entry.lastSize) return
  entry.lastSize = key
  entry.term.resize(proposed.cols, proposed.rows)
  void api('terminal.resize', { instanceId, cols: proposed.cols, rows: proposed.rows }).catch(() => undefined)
}

/** Mounts the instance's terminal into `host`. Returns a detach function. */
export const attachTerminal = (instanceId: string, host: HTMLElement): (() => void) => {
  const entry = entries.get(instanceId) ?? create(instanceId)
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
