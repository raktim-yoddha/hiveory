import { describe, expect, it } from 'vitest'
import { fileKind } from './file-kind'

describe('file icons by type (ADR 0065)', () => {
  it('reads the type from the extension, path or not', () => {
    expect(fileKind('src/app.ts')).toEqual(['code', 'blue'])
    expect(fileKind('C:\\code\\app\\index.JS')).toEqual(['code', 'yellow'])
    expect(fileKind('README.md')).toEqual(['text', 'blue'])
    expect(fileKind('logo.png')).toEqual(['image', 'green'])
  })

  it('knows files by their whole name first', () => {
    expect(fileKind('package-lock.json')).toEqual(['lock', 'muted'])
    expect(fileKind('Dockerfile')).toEqual(['container', 'cyan'])
    expect(fileKind('.env.local')).toEqual(['config', 'yellow'])
  })

  it('falls back to a plain file', () => {
    expect(fileKind('notes')).toEqual(['file', 'muted'])
    expect(fileKind('archive.unknownext')).toEqual(['file', 'muted'])
  })
})
