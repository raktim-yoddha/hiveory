import { describe, expect, it } from 'vitest'
import { groupCommits, parseChangelog, releaseBody } from './release-notes.mjs'

const CHANGELOG = `# Changelog

## Unreleased — Next things
- Not yet.

## v0.2.0 — Second
_2026-10-04_

- Work and Chat modes.
- Themes.

## v0.1.0 — First
_2026-10-04_

- First version.
`

describe('release notes', () => {
  it('reads titles, dates and highlights per version, skipping Unreleased', () => {
    const entries = parseChangelog(CHANGELOG)
    expect([...entries.keys()]).toEqual(['v0.2.0', 'v0.1.0'])
    expect(entries.get('v0.2.0')).toEqual({ tag: 'v0.2.0', title: 'Second', date: '2026-10-04', highlights: ['Work and Chat modes.', 'Themes.'] })
  })

  it('groups every commit exactly once, breaking first', () => {
    const commits = ['feat(x)!: drop keys', 'feat: add y', 'fix(z): stop crash', 'docs: note', 'added browser'].map((subject, i) => ({ sha: `c${i}`, subject }))
    const groups = groupCommits(commits)
    expect(groups.map(([t]) => t)).toEqual(['Breaking changes', 'Features', 'Fixes', 'Other', 'Changes'])
    expect(groups.flatMap(([, hits]) => hits)).toHaveLength(commits.length)
  })

  it('builds the body with banner, highlights, commits and compare link', () => {
    const entry = parseChangelog(CHANGELOG).get('v0.2.0')
    const body = releaseBody({ entry, commits: [{ sha: 'abc', subject: 'feat: modes' }], previous: 'v0.1.0', retroactive: true })
    expect(body).toContain('_Retroactive release: shipped on 2026-10-04')
    expect(body).toContain('### Highlights\n- Work and Chat modes.\n- Themes.')
    expect(body).toContain('### Features\n- feat: modes (abc)')
    expect(body).toContain('/compare/v0.1.0...v0.2.0')
  })
})
