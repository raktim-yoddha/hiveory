import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RoutineFiles } from './routine-files'

describe('routine files', () => {
  it('keeps a copy under a safe name, owns only its folder, and deletes only its own files', () => {
    const root = mkdtempSync(join(tmpdir(), 'hv-rfiles-'))
    const files = new RoutineFiles(join(root, 'routine-files'))
    const copy = files.add('../../evil name?.csv', Buffer.from('a,b').toString('base64'))
    expect(copy.path.startsWith(join(root, 'routine-files'))).toBe(true)
    expect(copy.name).toBe('evil name_.csv')
    expect(readFileSync(copy.path, 'utf8')).toBe('a,b')
    expect(files.owns(copy.path)).toBe(true)
    expect(files.owns(join(root, 'routine-files', '..', 'state.json'))).toBe(false)
    expect(files.owns(join(root, 'routine-files-other', 'x'))).toBe(false)
    files.remove([copy.path, join(root, 'elsewhere.txt')])
    expect(existsSync(copy.path)).toBe(false)
  })
})
