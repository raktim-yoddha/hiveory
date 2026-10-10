import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { findExecutable, type DiscoveryEnv } from '../discovery'
import { SHELL_ICONS } from './shell-icons'
import type { CliAdapter } from './types'

/** Git for Windows ships bash next to git: <Git>/cmd/git.exe or <Git>/mingw64/bin/git.exe → <Git>/bin/bash.exe. */
export const locateGitBash = (env: DiscoveryEnv, exists: (path: string) => boolean = existsSync): string | undefined => {
  if (env.platform !== 'win32') return undefined
  const git = findExecutable('git', env)
  if (!git) return undefined
  for (let dir = dirname(git), i = 0; i < 3; i++, dir = dirname(dir)) {
    const bash = join(dir, 'bin', 'bash.exe')
    if (exists(bash)) return bash
  }
  return undefined
}

/**
 * A login shell that also reads ~/.bashrc, as desktop terminals do. `bash -l` reads only the
 * profile files, so functions, aliases and PATH changes (nvm, conda) kept in ~/.bashrc were
 * missing unless the profile sourced it. Most profiles do; then ~/.bashrc is not read twice.
 */
export const BASH_RC = `[ -r /etc/profile ] && . /etc/profile
for __hiveory_rc in ~/.bash_profile ~/.bash_login ~/.profile; do
  [ -r "$__hiveory_rc" ] && break
  __hiveory_rc=
done
[ -n "$__hiveory_rc" ] && . "$__hiveory_rc"
if [ -r ~/.bashrc ] && ! grep -qs bashrc "\${__hiveory_rc:-/dev/null}"; then . ~/.bashrc; fi
unset __hiveory_rc
`

/** bash, interactive, starting from `BASH_RC` written at `rcFile` (POSIX path). */
export const bashArgs = (rcFile: string): string[] => ['--rcfile', rcFile, '-i']

const shell = (
  id: string,
  displayName: string,
  spec: {
    executables: string[]
    args?: string[]
    launch?: CliAdapter['buildLaunch']
    locate?: CliAdapter['locate']
    platforms?: CliAdapter['platforms']
  }
): CliAdapter => ({
  id,
  displayName,
  kind: 'shell',
  icon: { kind: 'image', src: SHELL_ICONS[id]! },
  executables: spec.executables,
  platforms: spec.platforms,
  locate: spec.locate,
  supportsAutoApprove: false,
  buildLaunch: spec.launch ?? (() => ({ args: spec.args ?? [] })),
  // A shell has no turns to detect: it simply stays idle.
  heuristics: () => null
})

/**
 * Plain terminals that open as panes beside the agents (listed first in the
 * pane "+" menu). They are not agents: no Kanban card, no chat.
 */
export const SHELL_ADAPTERS: CliAdapter[] = [
  // macOS and Linux (this computer or a remote host): the user's shells first (zsh is the macOS default).
  // Windows' bash.exe is WSL, so these stay off there.
  shell('zsh', 'zsh', { executables: ['zsh'], args: ['-l'], platforms: ['posix'] }),
  shell('bash', 'bash', {
    executables: ['bash'],
    // POSIX only, so the runtime folder joins with '/' (also on a remote host).
    launch: ({ runtimeDir }) => ({ args: bashArgs(`${runtimeDir}/bashrc`), files: [{ path: `${runtimeDir}/bashrc`, content: BASH_RC }] }),
    platforms: ['posix']
  }),
  shell('fish', 'fish', { executables: ['fish'], args: ['-l'], platforms: ['posix'] }),
  shell('powershell', 'PowerShell', { executables: ['pwsh', 'powershell'], args: ['-NoLogo'] }),
  shell('cmd', 'Command Prompt', { executables: ['cmd'], platforms: ['win32'] }),
  shell('gitbash', 'Git Bash', { executables: [], args: ['--login', '-i'], locate: (env) => locateGitBash(env), platforms: ['win32'] })
]
