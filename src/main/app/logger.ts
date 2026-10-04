import { appendFile, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export interface Logger {
  info(message: string, ...details: unknown[]): void
  warn(message: string, ...details: unknown[]): void
  error(message: string, ...details: unknown[]): void
}

const format = (details: unknown[]): string =>
  details
    .map((d) => (d instanceof Error ? (d.stack ?? d.message) : typeof d === 'string' ? d : JSON.stringify(d)))
    .join(' ')

/** Console + append-only file log. Logging must never throw. */
export const createLogger = (logDir: string): Logger => {
  let file: string | null = null
  try {
    mkdirSync(logDir, { recursive: true })
    file = join(logDir, 'main.log')
  } catch {
    file = null
  }
  const write = (level: string, message: string, details: unknown[]): void => {
    const line = `${new Date().toISOString()} [${level}] ${message} ${format(details)}`.trimEnd()
    if (level === 'error') console.error(line)
    else console.log(line)
    if (file) appendFile(file, line + '\n', () => undefined)
  }
  return {
    info: (m, ...d) => write('info', m, d),
    warn: (m, ...d) => write('warn', m, d),
    error: (m, ...d) => write('error', m, d)
  }
}
