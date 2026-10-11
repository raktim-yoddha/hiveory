import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { replayable, SAVED_OUTPUT_BYTES, savedOutputFile, saveOutput, takeOutput } from './saved-output'

describe('saved terminal output (ADR 0044)', () => {
  it('keeps whole lines of the tail and drops alternate-screen switches', () => {
    const long = `${'x'.repeat(SAVED_OUTPUT_BYTES)}\npartial-cut\nkept line\n\x1b[?1049hfull screen\x1b[?1049l\n`
    const out = replayable(long)
    expect(out.startsWith('partial-cut') || out.startsWith('kept line')).toBe(true)
    expect(out).not.toContain('\x1b[?1049')
    expect(out.length).toBeLessThanOrEqual(SAVED_OUTPUT_BYTES)
    expect(replayable('short\r\n')).toBe('short')
  })

  it('is read once, and an empty terminal leaves nothing behind', () => {
    const file = savedOutputFile(join(mkdtempSync(join(tmpdir(), 'hv-out-')), 'agent'))
    saveOutput(file, 'PS C:\\> dir\r\nREADME.md\r\n')
    expect(takeOutput(file)).toBe('PS C:\\> dir\r\nREADME.md')
    expect(takeOutput(file)).toBeNull()
    saveOutput(file, '   \r\n')
    expect(existsSync(file)).toBe(false)
  })
})
