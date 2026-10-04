import { describe, expect, it } from 'vitest'
import { generatePetName, generatePetNames, generateWorkspaceName, PET_NAMES, slugify, uniqueName } from './names'

const seq = (...values: number[]) => {
  let i = 0
  return () => values[i++ % values.length] as number
}

describe('pet names', () => {
  it('never reuses a taken name (case-insensitive)', () => {
    const taken = PET_NAMES.slice(1).map((n) => n.toUpperCase())
    expect(generatePetName(taken)).toBe(PET_NAMES[0])
  })

  it('generates distinct names in one batch', () => {
    const names = generatePetNames(20, [], seq(0))
    expect(new Set(names).size).toBe(20)
  })

  it('falls back to numbered names once the vocabulary is exhausted', () => {
    const name = generatePetName(PET_NAMES, seq(0))
    expect(name).toBe(`${PET_NAMES[0]} 2`)
    const many = generatePetNames(PET_NAMES.length * 2 + 3, [])
    expect(new Set(many.map((n) => n.toLowerCase())).size).toBe(many.length)
  })

  it('is deterministic for a given random source', () => {
    expect(generatePetNames(3, [], seq(0.1, 0.5, 0.9))).toEqual(generatePetNames(3, [], seq(0.1, 0.5, 0.9)))
  })
})

describe('workspace names and slugs', () => {
  it('avoids taken workspace names', () => {
    const first = generateWorkspaceName([], seq(0))
    expect(generateWorkspaceName([first], seq(0, 0, 0.5, 0.5))).not.toBe(first)
  })

  it('slugifies to git- and filesystem-safe names', () => {
    expect(slugify('Amber Harbor')).toBe('amber-harbor')
    expect(slugify('  Fix: login/éclair!! ')).toBe('fix-login-eclair')
    expect(slugify('***')).toBe('workspace')
    expect(slugify('x'.repeat(80)).length).toBeLessThanOrEqual(40)
  })

  it('suffixes until unique', () => {
    const taken = new Set(['a', 'a-2'])
    expect(uniqueName('a', (c) => taken.has(c))).toBe('a-3')
    expect(uniqueName('b', (c) => taken.has(c))).toBe('b')
  })
})
