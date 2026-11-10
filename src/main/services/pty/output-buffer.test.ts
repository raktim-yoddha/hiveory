import { describe, expect, it } from 'vitest'
import { OutputBuffer } from './output-buffer'

/** The plain meaning of the buffer: everything ever appended, cut to its newest `limit` characters. */
const reference = (limit: number) => {
  let all = ''
  return {
    append: (chunk: string): number => {
      const start = all.length
      all += chunk
      return start
    },
    snapshot: () => ({ data: all.slice(Math.max(0, all.length - limit)), end: all.length })
  }
}

describe('OutputBuffer', () => {
  it('starts empty', () => {
    expect(new OutputBuffer().snapshot()).toEqual({ data: '', end: 0 })
  })

  it('matches the newest characters of everything appended, with monotonic offsets, for any chunking', () => {
    // A fixed pseudo-random sequence: the same chunks every run.
    let seed = 42
    const random = (max: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed % max
    }
    for (const limit of [1, 7, 64, 1000]) {
      const buffer = new OutputBuffer(limit)
      const plain = reference(limit)
      for (let i = 0; i < 400; i++) {
        const chunk = String.fromCharCode(97 + (i % 26)).repeat(random(limit * 3) + (i % 5 === 0 ? 0 : 1))
        expect(buffer.append(chunk)).toBe(plain.append(chunk))
        // Snapshots in between must not change what later ones return.
        if (i % 7 === 0) expect(buffer.snapshot()).toEqual(plain.snapshot())
      }
      expect(buffer.snapshot()).toEqual(plain.snapshot())
    }
  })

  it('holds no more than its limit plus the newest chunk, however much is appended', () => {
    const buffer = new OutputBuffer(1000)
    for (let i = 0; i < 10_000; i++) buffer.append('x'.repeat(300))
    const held = (buffer as unknown as { chunks: string[] }).chunks.reduce((n, c) => n + c.length, 0)
    expect(held).toBeLessThanOrEqual(1300)
  })
})
