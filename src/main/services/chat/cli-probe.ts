import { spawn } from 'node:child_process'
import type { SpawnTarget } from '../pty/spawn-target'

/**
 * Asks a CLI a question over its JSON-lines stdio protocol (Claude Code's control requests, Codex's
 * app-server): writes `messages`, reads stdout until `answer` returns a value, then stops the process.
 * Nothing is sent to a model; the CLI answers from its own state and sign-in.
 */
export function probeCli<T>(
  target: SpawnTarget,
  messages: unknown[],
  answer: (message: Record<string, unknown>) => T | undefined,
  options: { env: NodeJS.ProcessEnv; cwd?: string; timeoutMs?: number }
): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = spawn(target.file, target.args, { cwd: options.cwd, env: options.env, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] })
    let buffer = ''
    let settled = false
    const finish = (error: Error | null, value?: T): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.kill()
      if (error) reject(error)
      else resolve(value as T)
    }
    const timer = setTimeout(() => finish(new Error('The CLI did not answer in time.')), options.timeoutMs ?? 30_000)
    child.on('error', (error) => finish(error))
    child.on('exit', () => finish(new Error('The CLI ended without answering.')))
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk
      let end: number
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).trim()
        buffer = buffer.slice(end + 1)
        if (!line.startsWith('{')) continue
        let message: unknown
        try {
          message = JSON.parse(line)
        } catch {
          continue
        }
        if (typeof message !== 'object' || message === null) continue
        try {
          const value = answer(message as Record<string, unknown>)
          if (value !== undefined) return finish(null, value)
        } catch (error) {
          return finish(error instanceof Error ? error : new Error(String(error)))
        }
      }
    })
    // The process may end on its own before every line is written; that surfaces as the exit above.
    child.stdin.on('error', () => undefined)
    child.stdin.write(messages.map((m) => JSON.stringify(m)).join('\n') + '\n')
  })
}

/** A Claude Code control request (stream-json input) and the success payload of its reply. */
export const claudeControl = (requestId: string, request: Record<string, unknown>): Record<string, unknown> => ({ type: 'control_request', request_id: requestId, request })

export const claudeControlReply = (message: Record<string, unknown>, requestId: string): Record<string, unknown> | undefined => {
  if (message.type !== 'control_response') return undefined
  const response = (message.response ?? {}) as Record<string, unknown>
  if (response.request_id !== requestId) return undefined
  if (response.subtype === 'error') throw new Error(typeof response.error === 'string' ? response.error : 'The CLI refused the request.')
  return (response.response ?? {}) as Record<string, unknown>
}

/** The headless Claude Code session that takes control requests on stdin. */
export const CLAUDE_CONTROL_ARGS = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--no-session-persistence']
