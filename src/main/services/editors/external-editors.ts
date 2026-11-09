import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { EditorApp, IconReference, OpenInApps } from '@shared/domain'
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

/* Marks drawn as one 24×24 path each, in the editor's own color (`evenodd` cuts the holes). */
const svg = (path: string, color: string): IconReference => ({ kind: 'svg', viewBox: '0 0 24 24', path, color, fillRule: 'evenodd' })
const RIBBON = 'M17.6 1.6 22 3.7v16.6l-4.4 2.1-8.7-8-4.4 3.4L2 16.5v-9l2.5-1.3 4.4 3.4 8.7-8ZM17.6 7.1 11.3 12l6.3 4.9V7.1ZM4.5 9.2v5.6L7.3 12 4.5 9.2Z'
const FOLDER = 'M2 6.5A2.5 2.5 0 0 1 4.5 4h4.8l2 2.2h8.2A2.5 2.5 0 0 1 22 8.7v8.8a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 17.5v-11Z'

const EDITORS: EditorDef[] = [
  { id: 'vscode', label: 'VS Code', icon: svg(RIBBON, '#23a8f2'), executables: ['code'], macApps: ['Visual Studio Code'] },
  { id: 'cursor', label: 'Cursor', icon: svg('M12 2l8.7 5v10L12 22l-8.7-5V7L12 2Zm0 2.6L5.7 8.2 12 11.8l6.3-3.6L12 4.6Z', '#d9d9d9'), executables: ['cursor'], macApps: ['Cursor'] },
  { id: 'windsurf', label: 'Windsurf', icon: svg('M2 6h3.2l2.6 8.6L10.5 6h3l2.7 8.6L18.8 6H22l-4.3 12h-3l-2.7-8.2L9.3 18h-3L2 6Z', '#44d5bc'), executables: ['windsurf'], macApps: ['Windsurf'] },
  { id: 'zed', label: 'Zed', icon: svg('M3 3h18v18H3V3Zm4 4v2.4h6.7L7 14.6V17h10v-2.4h-6.7L17 9.4V7H7Z', '#3d7ef6'), executables: ['zed', 'zeditor'], macApps: ['Zed'] },
  { id: 'vscodium', label: 'VSCodium', icon: svg(RIBBON, '#2f6fed'), executables: ['codium'], macApps: ['VSCodium'] },
  { id: 'sublime', label: 'Sublime Text', icon: svg('M18.5 3.2v4.4L5.5 11.7V7.3l13-4.1ZM5.5 8.6v4.4l13 4.1v-4.4L5.5 8.6ZM18.5 12.3v4.4L5.5 20.8v-4.4l13-4.1Z', '#ff9800'), executables: ['subl'], macApps: ['Sublime Text'] },
  { id: 'idea', label: 'IntelliJ IDEA', icon: { kind: 'monogram', text: 'IJ', color: '#fe315d' }, executables: ['idea', 'idea64'], macApps: ['IntelliJ IDEA', 'IntelliJ IDEA CE'] },
  { id: 'webstorm', label: 'WebStorm', icon: { kind: 'monogram', text: 'WS', color: '#07c3f2' }, executables: ['webstorm', 'webstorm64'], macApps: ['WebStorm'] },
  { id: 'pycharm', label: 'PyCharm', icon: { kind: 'monogram', text: 'PC', color: '#21d789' }, executables: ['pycharm', 'pycharm64'], macApps: ['PyCharm', 'PyCharm CE'] }
]

/** This system's file manager, named and drawn as the user knows it. */
const FILE_MANAGER: Record<'win32' | 'darwin' | 'other', OpenInApps['fileManager']> = {
  win32: { label: 'File Explorer', icon: svg(FOLDER, '#f4c542') },
  darwin: {
    label: 'Finder',
    icon: svg('M5 2h14a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3Zm3 6v3h1.6V8H8Zm7 0v3h1.6V8H15Zm-7.5 7.2.8 1.1c3.1 2.2 7.5 2.2 10.6 0l-.8-1.1c-2.6 1.8-6.4 1.8-9 0Z', '#3ba7f5')
  },
  other: { label: 'Files', icon: svg(FOLDER, '#9aa0a6') }
}

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
  EDITORS.filter((e) => launchOf(e, env)).map(({ id, label, icon }) => ({ id, label, icon }))

/** What Open in offers on this computer. */
export const openInApps = (env: DiscoveryEnv = here()): OpenInApps => ({
  editors: installedEditors(env),
  fileManager: FILE_MANAGER[env.platform === 'win32' || env.platform === 'darwin' ? env.platform : 'other']
})

/** Opens `folder` in editor `id`, detached: the editor outlives Hiveory. False when it is not installed. */
export function openInEditor(id: string, folder: string): boolean {
  const editor = EDITORS.find((e) => e.id === id)
  const launch = editor && launchOf(editor, here())
  if (!launch) return false
  const target = resolveSpawnTarget(launch.file, launch.args(folder))
  spawn(target.file, target.args, { cwd: folder, detached: true, windowsHide: true, stdio: 'ignore', env: sanitizeEnv(process.env) }).unref()
  return true
}
