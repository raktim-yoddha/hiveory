import { describe, expect, it } from 'vitest'
import { APPS, COMPOSIO } from '@shared/domain'
import { APP_LOGOS } from './app-logos'

describe('app logos', () => {
  it('has a real brand mark for every app and for Composio', () => {
    expect([...APPS.map((a) => a.id), COMPOSIO.id].filter((id) => !APP_LOGOS[id])).toEqual([])
    for (const svg of Object.values(APP_LOGOS)) {
      expect(svg.startsWith('<svg')).toBe(true)
      expect(svg).not.toMatch(/<script|<foreignObject|<image|on\w+=/i)
    }
  })
})
