import { describe, expect, it } from 'vitest'
import { compare, nextVersions, parse, validateRelease } from './semver.mjs'

describe('semver parsing and precedence', () => {
  it('accepts valid versions and rejects invalid ones', () => {
    for (const v of ['0.1.0', '1.0.0', '1.2.3-alpha', '1.2.3-alpha.1', '1.0.0-0.3.7', '1.0.0+build.1', 'v2.0.0']) expect(parse(v), v).not.toBeNull()
    for (const v of ['1', '1.2', '01.2.3', '1.2.3-', '1.2.3-01', 'a.b.c', '1.2.3.4', '']) expect(parse(v), v).toBeNull()
  })

  it('orders per SemVer §11', () => {
    const order = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0', '1.0.1', '1.1.0', '2.0.0']
    for (let i = 1; i < order.length; i++) expect(compare(parse(order[i]), parse(order[i - 1])), `${order[i]} > ${order[i - 1]}`).toBeGreaterThan(0)
    expect(compare(parse('1.0.0+a'), parse('1.0.0+b'))).toBe(0)
  })

  it('computes next versions', () => {
    expect(nextVersions('0.1.0')).toEqual({ patch: '0.1.1', minor: '0.2.0', major: '1.0.0' })
    expect(nextVersions('1.2.0-rc.1').patch).toBe('1.2.0')
  })
})

describe('release validation', () => {
  it('allows one-step bumps', () => {
    expect(validateRelease('0.1.1', '0.1.0')).toMatchObject({ valid: true, kind: 'patch' })
    expect(validateRelease('0.2.0', '0.1.0')).toMatchObject({ valid: true, kind: 'minor' })
    expect(validateRelease('v1.0.0', '0.1.0')).toMatchObject({ valid: true, kind: 'major', version: '1.0.0' })
    expect(validateRelease('0.2.0-beta.1', '0.1.0')).toMatchObject({ valid: true, prerelease: true })
    expect(validateRelease('0.2.0', '0.2.0-beta.1')).toMatchObject({ valid: true })
    expect(validateRelease('0.2.0-beta.2', '0.2.0-beta.1')).toMatchObject({ valid: true })
  })

  it('explains every rejection', () => {
    expect(validateRelease('1.2', '0.1.0').reason).toMatch(/not a valid SemVer/)
    expect(validateRelease('0.1.0', '0.1.0').reason).toMatch(/not greater/)
    expect(validateRelease('0.0.9', '0.1.0').reason).toMatch(/not greater/)
    expect(validateRelease('0.3.0', '0.1.0').reason).toMatch(/skips versions/)
    expect(validateRelease('0.1.2', '0.1.0').reason).toMatch(/skips versions/)
    expect(validateRelease('0.2.1', '0.1.0').reason).toMatch(/skips versions/)
    expect(validateRelease('0.1.1+build', '0.1.0').reason).toMatch(/build metadata/)
    expect(validateRelease('0.1.1', '0.1.0', ['v0.1.1']).reason).toMatch(/already released/)
  })
})
