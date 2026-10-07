import { describe, expect, it } from 'vitest'
import { PALETTES } from '../src/core/theme/palettes.ts'
import { desktopPalettes } from './theme-from-desktop.mjs'

describe('phone theme', () => {
  it("wears the desktop's colors exactly (run pnpm sync:theme after changing tokens.css)", () => {
    expect(JSON.parse(JSON.stringify(PALETTES))).toEqual(desktopPalettes())
  })
})
