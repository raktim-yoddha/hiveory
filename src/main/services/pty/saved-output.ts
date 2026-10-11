import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * A terminal's output kept on disk while it is not running (ADR 0044): when Hiveory quits or its
 * Workspace is removed, the tail is saved; when the pane starts again it is drawn first, so a terminal
 * keeps its memory without a process (or its RAM) staying alive. Agents that resume a conversation
 * redraw it themselves, so theirs is dropped.
 */
export const SAVED_OUTPUT_BYTES = 64 * 1024

/** Alternate-screen switches: replaying one would leave the pane on an empty full-screen buffer. */
// eslint-disable-next-line no-control-regex
const ALT_SCREEN = /\x1b\[\?(?:1049|1047|47)[hl]/g

export const savedOutputFile = (runtimeDir: string): string => join(runtimeDir, 'scrollback.txt')

/** The last whole lines of `data`, at most SAVED_OUTPUT_BYTES, safe to draw into a fresh terminal. */
export const replayable = (data: string): string => {
  let tail = data.length > SAVED_OUTPUT_BYTES ? data.slice(data.length - SAVED_OUTPUT_BYTES) : data
  // Start on a line of its own, so a cut never lands inside an escape sequence.
  if (tail.length < data.length) tail = tail.slice(tail.indexOf('\n') + 1)
  return tail.replace(ALT_SCREEN, '').replace(/\s+$/, '')
}

export const saveOutput = (file: string, data: string): void => {
  const text = replayable(data)
  try {
    if (!text) return rmSync(file, { force: true })
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, text, 'utf8')
  } catch {
    // Keeping output is a convenience: a full or read-only disk never stops a terminal.
  }
}

/** The saved output, removed as it is read (it is drawn once). */
export const takeOutput = (file: string): string | null => {
  try {
    const text = readFileSync(file, 'utf8')
    rmSync(file, { force: true })
    return text || null
  } catch {
    return null
  }
}

export const forgetOutput = (file: string): void => {
  try {
    rmSync(file, { force: true })
  } catch {
    // Already gone.
  }
}
