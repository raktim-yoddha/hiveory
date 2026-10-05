import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import type { Logger } from './logger'

const MARK = '__HIVEORY_PATH__'

/** Where package managers put CLIs, for when the login shell can't be read. */
export const commonBinDirs = (home: string, platform: NodeJS.Platform): string[] => [
  ...(platform === 'darwin' ? ['/opt/homebrew/bin', '/opt/homebrew/sbin'] : []),
  '/usr/local/bin',
  join(home, '.local', 'bin'),
  join(home, '.npm-global', 'bin'),
  join(home, '.bun', 'bin'),
  join(home, '.volta', 'bin'),
  join(home, '.cargo', 'bin'),
  join(home, '.deno', 'bin')
]

/** The PATH between the markers, tolerant of anything rc files print around it. */
export const parseShellPath = (output: string): string | null => {
  const match = new RegExp(`${MARK}([^\\n]*?)${MARK}`).exec(output)
  return match?.[1]?.trim() || null
}

/** Joins PATH lists, keeping the first occurrence of each directory. */
export const mergePaths = (...lists: Array<string | undefined>): string =>
  [...new Set(lists.flatMap((l) => (l ?? '').split(delimiter)).filter(Boolean))].join(delimiter)

/**
 * Apps launched from the macOS Finder (or a Linux desktop launcher) start with a
 * minimal PATH, so CLIs in Homebrew, ~/.local/bin or npm's global bin would go
 * undetected and npx/uvx plugins would fail. Ask the user's login shell for its
 * PATH once at startup, as terminals see it. Windows apps inherit the full PATH.
 */
export async function adoptLoginShellPath(log: Logger): Promise<void> {
  if (process.platform === 'win32') return
  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  const fromShell = await new Promise<string | null>((resolve) => {
    execFile(
      shell,
      ['-ilc', `printf '${MARK}%s${MARK}' "$PATH"`],
      // Keep rc files from prompting or auto-updating while they run headless.
      { timeout: 5000, env: { ...process.env, DISABLE_AUTO_UPDATE: 'true', ZSH_DISABLE_COMPFIX: 'true' }, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        const path = parseShellPath(String(stdout ?? ''))
        if (!path && error) log.warn(`Could not read the login shell's PATH (${shell}): ${error.message}`)
        resolve(path)
      }
    )
  })
  process.env.PATH = mergePaths(fromShell ?? undefined, process.env.PATH, commonBinDirs(homedir(), process.platform).join(delimiter))
}
