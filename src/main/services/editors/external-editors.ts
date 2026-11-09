import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { EditorApp } from '@shared/domain'
import { findExecutable, type DiscoveryEnv } from '../cli/discovery'
import { sanitizeEnv } from '../pty/env'
import { resolveSpawnTarget } from '../pty/spawn-target'

/**
 * Code editors a worktree can open in (the top bar's Open in, ADR 0064): each by its command-line
 * launcher on PATH, or on macOS by its app bundle. Only the ones installed are offered.
 */
interface EditorDef extends EditorApp {
  executables: string[]
  /** macOS app bundle names, for editors installed without their shell command. */
  macApps?: string[]
}

const EDITORS: EditorDef[] = [
  { id: 'vscode', label: 'VS Code', executables: ['code'], macApps: ['Visual Studio Code'] },
  { id: 'cursor', label: 'Cursor', executables: ['cursor'], macApps: ['Cursor'] },
  { id: 'windsurf', label: 'Windsurf', executables: ['windsurf'], macApps: ['Windsurf'] },
  { id: 'zed', label: 'Zed', executables: ['zed', 'zeditor'], macApps: ['Zed'] },
  { id: 'vscodium', label: 'VSCodium', executables: ['codium'], macApps: ['VSCodium'] },
  { id: 'sublime', label: 'Sublime Text', executables: ['subl'], macApps: ['Sublime Text'] },
  { id: 'idea', label: 'IntelliJ IDEA', executables: ['idea', 'idea64'], macApps: ['IntelliJ IDEA', 'IntelliJ IDEA CE'] },
  { id: 'webstorm', label: 'WebStorm', executables: ['webstorm', 'webstorm64'], macApps: ['WebStorm'] },
  { id: 'pycharm', label: 'PyCharm', executables: ['pycharm', 'pycharm64'], macApps: ['PyCharm', 'PyCharm CE'] }
]

/** How to start one editor on a folder: its launcher, or `open -a` for a macOS bundle. */
type Launch = { file: string; args: (folder: string) => string[] }

const launchOf = (editor: EditorDef, env: DiscoveryEnv): Launch | undefined => {
  for (const name of editor.executables) {
    const found = findExecutable(name, env)
    if (found) return { file: found, args: (folder) => [folder] }
  }
  if (env.platform === 'darwin') {
    const app = editor.macApps?.find((a) => existsSync(`/Applications/${a}.app`))
    if (app) return { file: 'open', args: (folder) => ['-a', app, folder] }
  }
  return undefined
}

const here = (): DiscoveryEnv => ({ platform: process.platform, path: process.env.PATH ?? '', pathExt: process.env.PATHEXT })

/** The installed editors, in the order above. */
export const installedEditors = (env: DiscoveryEnv = here()): EditorApp[] =>
  EDITORS.filter((e) => launchOf(e, env)).map(({ id, label }) => ({ id, label }))

/** Opens `folder` in editor `id`, detached: the editor outlives Hiveory. False when it is not installed. */
export function openInEditor(id: string, folder: string): boolean {
  const editor = EDITORS.find((e) => e.id === id)
  const launch = editor && launchOf(editor, here())
  if (!launch) return false
  const target = resolveSpawnTarget(launch.file, launch.args(folder))
  spawn(target.file, target.args, { cwd: folder, detached: true, windowsHide: true, stdio: 'ignore', env: sanitizeEnv(process.env) }).unref()
  return true
}
