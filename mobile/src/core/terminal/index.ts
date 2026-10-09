export { TerminalView, type TerminalHandle } from './TerminalView'
export { mergeChunk } from './merge'

/** Keys a phone keyboard lacks, as the bytes a terminal expects. */
export const KEYS = {
  enter: '\r',
  escape: '\x1b',
  tab: '\t',
  slash: '/',
  up: '\x1b[A',
  down: '\x1b[B',
  left: '\x1b[D',
  right: '\x1b[C',
  interrupt: '\x03'
} as const
