import { describe, expect, it } from 'vitest'
import { droppedPathsText, quotePath } from './drop-paths'

describe('files dropped on a terminal (ADR 0061)', () => {
  it('quotes Windows paths only when needed', () => {
    expect(quotePath('C:\\work\\a.png', 'windows')).toBe('C:\\work\\a.png')
    expect(quotePath('C:\\My Files\\a b.png', 'windows')).toBe('"C:\\My Files\\a b.png"')
    expect(quotePath('C:\\x&y\\z.txt', 'windows')).toBe('"C:\\x&y\\z.txt"')
  })

  it('single-quotes POSIX paths, escaping quotes inside', () => {
    expect(quotePath('/home/me/a.png', 'posix')).toBe('/home/me/a.png')
    expect(quotePath('/home/me/my file.png', 'posix')).toBe("'/home/me/my file.png'")
    expect(quotePath("/home/me/it's.txt", 'posix')).toBe("'/home/me/it'\\''s.txt'")
    expect(quotePath('/tmp/$(rm -rf ~)', 'posix')).toBe("'/tmp/$(rm -rf ~)'")
  })

  it('joins several and skips files without a path', () => {
    expect(droppedPathsText(['/a', '', '/b c'], 'posix')).toBe("/a '/b c' ")
    expect(droppedPathsText(['', ''], 'posix')).toBe('')
  })
})
