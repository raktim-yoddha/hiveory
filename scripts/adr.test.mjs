import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// AGENTS.md rule 29: what every ADR must look like. ADRs before 0037 kept older shapes (feedback
// rounds); from 0037 on, the full shape is required.
const dir = new URL('../adr/', import.meta.url)
const files = readdirSync(dir).filter((f) => f.endsWith('.md'))
const FULL_SHAPE_FROM = 37

describe('ADRs (AGENTS.md rule 29)', () => {
  it('are named NNNN-short-kebab-name.md with unique numbers', () => {
    for (const f of files) expect(f, f).toMatch(/^\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/)
    const numbers = files.map((f) => Number(f.slice(0, 4)))
    expect(new Set(numbers).size, 'two ADRs share a number').toBe(numbers.length)
  })

  it('open with "# ADR NNNN — Title" matching their file name', () => {
    for (const f of files) {
      const title = readFileSync(new URL(f, dir), 'utf8').split(/\r?\n/)[0]
      expect(title, f).toMatch(new RegExp(`^# ADR ${f.slice(0, 4)} — \\S`))
    }
  })

  it('take the next free number, with no gaps from the full shape on', () => {
    const recent = files.map((f) => Number(f.slice(0, 4))).filter((n) => n >= FULL_SHAPE_FROM).sort((a, b) => a - b)
    recent.forEach((n, i) => expect(n, 'use the next free number').toBe(FULL_SHAPE_FROM + i))
  })

  it('from 0037 on: say who decided and when, then Context, Decision, Consequences', () => {
    for (const f of files.filter((f) => Number(f.slice(0, 4)) >= FULL_SHAPE_FROM)) {
      const text = readFileSync(new URL(f, dir), 'utf8')
      expect(text, `${f}: "Decided by …, YYYY-MM-DD."`).toMatch(/Decided by .+, \d{4}-\d{2}-\d{2}\./)
      for (const section of ['## Context', '## Decision', '## Consequences']) expect(text, `${f}: ${section}`).toMatch(new RegExp(`^${section}\\b`, 'm'))
    }
  })
})
