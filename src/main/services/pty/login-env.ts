import { execFile } from 'node:child_process'

/**
 * CLI login variables come from the user's saved environment, not Hiveory's own (ADR 0063).
 *
 * A process keeps the environment it started with. When Hiveory is launched from a shell or app
 * that still holds an old token, endpoint or model (an API proxy the user has since removed), every
 * agent would inherit it and the CLI would use it instead of its own login. So before any local
 * process starts, each login variable is taken from where the user saves them now: the Windows
 * user and machine environment, or the login shell's on macOS and Linux. One that is no longer
 * saved is dropped. Everything else Hiveory was started with is left as it is.
 */

/** Saved variables by the name they compare under (upper case on Windows, where names ignore case). */
export type SavedEnv = Map<string, { name: string; value: string }>

const MARK = '__HIVEORY_ENV__'

const keyOf = (name: string, platform: NodeJS.Platform): string => (platform === 'win32' ? name.toUpperCase() : name)

/** Whether a variable name is one of `patterns` (`NAME_*` is a prefix). Login variables are upper case by convention. */
export const isLoginVar = (name: string, patterns: readonly string[]): boolean => {
  const upper = name.toUpperCase()
  return patterns.some((p) => (p.endsWith('*') ? upper.startsWith(p.slice(0, -1)) : upper === p))
}

/** `env` with every login variable replaced by its saved value, or removed when none is saved. */
export function applySavedLoginEnv(
  env: Record<string, string | undefined>,
  saved: SavedEnv,
  patterns: readonly string[],
  platform: NodeJS.Platform = process.platform
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {}
  for (const [name, value] of Object.entries(env)) if (!isLoginVar(name, patterns)) out[name] = value
  for (const { name, value } of saved.values()) if (isLoginVar(name, patterns) && value) out[platform === 'win32' ? name.toUpperCase() : name] = value
  return out
}

/** Expands `%NAME%` the way Windows does for REG_EXPAND_SZ values; unknown names stay as written. */
const expand = (value: string, lookup: (name: string) => string | undefined): string => value.replace(/%([^%]+)%/g, (all, name: string) => lookup(name) ?? all)

/**
 * The variables in `reg query` output, machine first then user (the user's win, as in Windows).
 * Lines look like `    NAME    REG_SZ    value`.
 */
export function parseRegQuery(outputs: string[], processEnv: Record<string, string | undefined>): SavedEnv {
  const saved: SavedEnv = new Map()
  const lookup = (name: string): string | undefined => saved.get(name.toUpperCase())?.value ?? processEnv[name] ?? processEnv[name.toUpperCase()]
  for (const output of outputs) {
    for (const line of output.split(/\r?\n/)) {
      const match = /^ {4}(\S(?:.*?\S)?) {4}(REG_\w+)(?: {4}(.*))?$/.exec(line)
      if (!match) continue
      const [, name, type, raw = ''] = match
      saved.set(name!.toUpperCase(), { name: name!, value: type === 'REG_EXPAND_SZ' ? expand(raw, lookup) : raw })
    }
  }
  return saved
}

/** The `env` listing between the markers (rc files may print around it). */
export function parseEnvDump(output: string, platform: NodeJS.Platform): SavedEnv | null {
  const start = output.indexOf(MARK)
  const end = output.lastIndexOf(MARK)
  if (start < 0 || end <= start) return null
  const saved: SavedEnv = new Map()
  for (const line of output.slice(start + MARK.length, end).split('\n')) {
    const at = line.indexOf('=')
    if (at > 0) saved.set(keyOf(line.slice(0, at), platform), { name: line.slice(0, at), value: line.slice(at + 1) })
  }
  return saved
}

const run = (file: string, args: string[], env?: Record<string, string | undefined>): Promise<string | null> =>
  new Promise((resolve) =>
    execFile(file, args, { timeout: 5000, windowsHide: true, maxBuffer: 1024 * 1024, ...(env ? { env } : {}) }, (error, stdout) =>
      resolve(error && !stdout ? null : String(stdout ?? ''))
    )
  )

const MACHINE_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'

/** Reads the saved environment, or null when it can't be read (then nothing is changed). */
export async function readSavedEnv(patterns: readonly string[], platform: NodeJS.Platform = process.platform): Promise<SavedEnv | null> {
  if (platform === 'win32') {
    const [machine, user] = await Promise.all([run('reg', ['query', MACHINE_KEY]), run('reg', ['query', 'HKCU\\Environment'])])
    if (machine === null && user === null) return null
    return parseRegQuery([machine ?? '', user ?? ''], process.env)
  }
  // The login shell, started without the inherited login variables, shows what the user's rc files set.
  const shell = process.env.SHELL || (platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  const clean: Record<string, string | undefined> = { DISABLE_AUTO_UPDATE: 'true', ZSH_DISABLE_COMPFIX: 'true' }
  for (const [name, value] of Object.entries(process.env)) if (!isLoginVar(name, patterns)) clean[name] = value
  const output = await run(shell, ['-ilc', `[ -n "$BASH_VERSION" ] && [ -r ~/.bashrc ] && . ~/.bashrc >/dev/null 2>&1; printf '${MARK}'; env; printf '${MARK}'`], clean)
  return output === null ? null : parseEnvDump(output, platform)
}

const REFRESH_AFTER_MS = 3000

/**
 * The saved login environment Hiveory applies to every local process. `refresh` re-reads it (at
 * startup, when the window is focused, and after each start), so a change the user made is in effect
 * by the time they open the next agent. Until the first read succeeds, environments are left alone.
 */
class LoginEnv {
  private patterns: readonly string[] = []
  private saved: SavedEnv | null = null
  private reading: Promise<void> | null = null
  private readAt = 0

  configure(patterns: readonly string[]): void {
    this.patterns = patterns
  }

  refresh(): Promise<void> {
    if (!this.patterns.length) return Promise.resolve()
    this.reading ??= readSavedEnv(this.patterns)
      .then((saved) => {
        // A failed read keeps the last good one.
        if (saved) this.saved = saved
      })
      .catch(() => undefined)
      .finally(() => {
        this.readAt = Date.now()
        this.reading = null
      })
    return this.reading
  }

  apply(env: Record<string, string | undefined>): Record<string, string | undefined> {
    if (Date.now() - this.readAt > REFRESH_AFTER_MS) void this.refresh()
    return this.saved ? applySavedLoginEnv(env, this.saved, this.patterns) : env
  }
}

export const loginEnv = new LoginEnv()
