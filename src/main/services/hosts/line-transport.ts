import type { Readable, Writable } from 'node:stream'
import type { HostFrame, HostTransport } from '@shared/host/protocol'

/**
 * Longest frame accepted (ADR 0050 §2). `pty.attach` carries up to 2 MiB of kept output,
 * which JSON escaping can more than double; anything past this closes the connection.
 */
export const MAX_FRAME = 16 * 1024 * 1024

/** One JSON frame per line over a pair of streams (stdio, or a socket). */
export const lineTransport = (input: Readable, output: Writable, close: () => void): HostTransport => {
  const frames: Array<(f: HostFrame) => void> = []
  const closes: Array<() => void> = []
  let buffer = ''
  let closed = false
  const end = (): void => {
    if (closed) return
    closed = true
    closes.forEach((l) => l())
  }
  input.setEncoding('utf8')
  input.on('data', (chunk: string) => {
    buffer += chunk
    // Lines are read where they lie and the rest is kept once: cutting the buffer after each line
    // would copy it again per line, which falls behind when terminals print fast in small pieces.
    let start = 0
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      const line = buffer.slice(start, newline).trim()
      start = newline + 1
      if (line) {
        try {
          const frame = JSON.parse(line) as HostFrame
          for (const l of frames) l(frame)
        } catch {
          // A malformed line is ignored; the client times the call out.
        }
      }
      newline = buffer.indexOf('\n', start)
    }
    if (start) buffer = buffer.slice(start)
    if (buffer.length > MAX_FRAME) {
      buffer = ''
      end()
      close()
    }
  })
  input.on('end', end)
  input.on('close', end)
  input.on('error', end)
  output.on('error', end)
  return {
    send: (frame) => {
      if (!closed) output.write(`${JSON.stringify(frame)}\n`)
    },
    onFrame: (l) => void frames.push(l),
    onClose: (l) => void closes.push(l),
    backlog: () => output.writableLength,
    onDrain: (l) => void output.once('drain', l),
    close: () => {
      end()
      close()
    }
  }
}
