import type { HostFrame, HostTransport } from '@shared/host/protocol'
import { serveHost } from './host-server'

/**
 * hiveoryd entry. Locally it runs as an Electron utility process (frames over its
 * parent port), so a crash in native PTY code never takes the app down. Started
 * without a parent port it speaks one JSON frame per line on stdin/stdout, which is
 * how it runs on a remote machine over SSH (ADR 0022).
 */
interface ParentPort {
  on(event: 'message', listener: (message: { data: unknown }) => void): void
  postMessage(message: unknown): void
}

const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort

const portTransport = (port: ParentPort): HostTransport => {
  const closes: Array<() => void> = []
  process.on('disconnect', () => closes.forEach((l) => l()))
  return {
    send: (frame) => port.postMessage(frame),
    onFrame: (listener) => port.on('message', (message) => listener(message.data as HostFrame)),
    onClose: (listener) => void closes.push(listener),
    close: () => process.exit(0)
  }
}

const stdioTransport = (): HostTransport => {
  const frames: Array<(f: HostFrame) => void> = []
  const closes: Array<() => void> = []
  let buffer = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line) {
        try {
          const frame = JSON.parse(line) as HostFrame
          for (const l of frames) l(frame)
        } catch {
          // A malformed line is ignored; the client times the call out.
        }
      }
      newline = buffer.indexOf('\n')
    }
  })
  process.stdin.on('end', () => closes.forEach((l) => l()))
  return {
    send: (frame) => void process.stdout.write(`${JSON.stringify(frame)}\n`),
    onFrame: (l) => void frames.push(l),
    onClose: (l) => void closes.push(l),
    close: () => process.exit(0)
  }
}

const transport = parentPort ? portTransport(parentPort) : stdioTransport()
transport.onClose(() => setTimeout(() => process.exit(0), 100))
// A bug in one request must not end every PTY on this machine.
process.on('uncaughtException', (error) => console.error('hiveoryd: uncaught exception', error))
process.on('unhandledRejection', (reason) => console.error('hiveoryd: unhandled rejection', reason))
serveHost(transport)
