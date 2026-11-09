import { describe, expect, it } from 'vitest'
import { installedEditors } from './external-editors'

describe('Open in: installed editors (ADR 0064)', () => {
  it('offers only editors whose launcher is on PATH, in a fixed order', () => {
    const present = new Set(['C:\\bin\\cursor.cmd', 'C:\\bin\\code.cmd'])
    const apps = installedEditors({ platform: 'win32', path: 'C:\\bin', pathExt: '.EXE;.CMD', isExecutable: (f) => present.has(f) })
    expect(apps).toEqual([
      { id: 'vscode', label: 'VS Code' },
      { id: 'cursor', label: 'Cursor' }
    ])
  })

  it('finds an editor by any of its launchers', () => {
    const apps = installedEditors({ platform: 'linux', path: '/usr/bin', isExecutable: (f) => f === '/usr/bin/zeditor' })
    expect(apps.map((a) => a.id)).toEqual(['zed'])
  })

  it('offers nothing when none is installed', () => {
    expect(installedEditors({ platform: 'linux', path: '/usr/bin', isExecutable: () => false })).toEqual([])
  })
})
