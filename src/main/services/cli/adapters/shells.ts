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

const shell = (id: string, displayName: string, spec: { executables: string[]; args?: string[]; locate?: CliAdapter['locate'] }): CliAdapter => ({
  id,
  displayName,
  kind: 'shell',
  icon: { kind: 'image', src: SHELL_ICONS[id]! },
  executables: spec.executables,
  locate: spec.locate,
  supportsAutoApprove: false,
  buildLaunch: () => ({ args: spec.args ?? [] }),
  // A shell has no turns to detect: it simply stays idle.
  heuristics: () => null
})

/**
 * Plain terminals that open as panes beside the agents (listed first in the
 * pane "+" menu). They are not agents: no Kanban card, no chat.
 */
export const SHELL_ADAPTERS: CliAdapter[] = [
  shell('powershell', 'PowerShell', { executables: ['pwsh', 'powershell'], args: ['-NoLogo'] }),
  shell('cmd', 'Command Prompt', { executables: process.platform === 'win32' ? ['cmd'] : [] }),
  shell('gitbash', 'Git Bash', { executables: [], args: ['--login', '-i'], locate: (env) => locateGitBash(env) })
]
