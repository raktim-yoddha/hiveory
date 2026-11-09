import { describe, expect, it } from 'vitest'
import { readable } from './code-host'

describe("a code host CLI's message, as a sentence (ADR 0065)", () => {
  it('rewords what the CLIs say most often', () => {
    expect(readable('no git remotes found')).toBe('This repository has no GitHub or GitLab remote yet.')
    expect(readable('error: HTTP 401: Bad credentials (https://api.github.com/graphql)')).toBe('The code host CLI is not signed in.')
  })

  it('keeps the first line, capitalized and ended', () => {
    expect(readable('could not find repository\nmore detail')).toBe('Could not find repository.')
    expect(readable('Already a sentence!')).toBe('Already a sentence!')
  })
})
