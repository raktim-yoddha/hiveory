import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// AGENTS.md (read by most agents) and CLAUDE.md (read by Claude) are one engineering contract.
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

describe('the engineering contract', () => {
  it('is the same in AGENTS.md and CLAUDE.md', () => {
    expect(read('CLAUDE.md'), 'Make the same change in AGENTS.md and CLAUDE.md.').toBe(read('AGENTS.md'))
  })
})
