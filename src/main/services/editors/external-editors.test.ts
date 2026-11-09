import { describe, expect, it } from 'vitest'
import { installedEditors, openInApps } from './external-editors'

describe('Open in: installed editors (ADR 0064)', () => {
  it('offers only editors whose launcher is on PATH, in a fixed order', () => {
    const present = new Set(['C:\\bin\\cursor.cmd', 'C:\\bin\\code.cmd'])
    const apps = installedEditors({ platform: 'win32', path: 'C:\\bin', pathExt: '.EXE;.CMD', isExecutable: (f) => present.has(f) })
    expect(apps.map((a) => [a.id, a.label])).toEqual([
      ['vscode', 'VS Code'],
      ['cursor', 'Cursor']
    ])
    expect(apps.every((a) => a.icon.kind === 'svg' || a.icon.kind === 'monogram')).toBe(true)
  })

  it('finds an editor by any of its launchers', () => {
    const apps = installedEditors({ platform: 'linux', path: '/usr/bin', isExecutable: (f) => f === '/usr/bin/zeditor' })
    expect(apps.map((a) => a.id)).toEqual(['zed'])
  })

  it('names the file manager as the system does', () => {
    expect(openInApps({ platform: 'win32', path: '', isExecutable: () => false }).fileManager.label).toBe('File Explorer')
    expect(openInApps({ platform: 'darwin', path: '', isExecutable: () => false }).fileManager.label).toBe('Finder')
    expect(openInApps({ platform: 'linux', path: '', isExecutable: () => false }).fileManager.label).toBe('Files')
  })

  it('offers nothing when none is installed', () => {
    expect(installedEditors({ platform: 'linux', path: '/usr/bin', isExecutable: () => false })).toEqual([])
  })
})
