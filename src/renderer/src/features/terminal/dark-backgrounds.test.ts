import { describe, expect, it } from 'vitest'
import { createDarkBackgroundFilter } from './dark-backgrounds'

const ESC = '\x1b'

describe('dark background filter', () => {
  it('drops near-black screen fills and keeps lighter ones', () => {
    const filter = createDarkBackgroundFilter()
    expect(filter(`${ESC}[48;2;12;10;9mhi`)).toBe(`${ESC}[49mhi`)
    expect(filter(`${ESC}[1;48;2;20;20;20;38;2;255;0;0mx`)).toBe(`${ESC}[1;49;38;2;255;0;0mx`)
    expect(filter(`${ESC}[48;2;45;49;57mbox`)).toBe(`${ESC}[48;2;45;49;57mbox`)
    expect(filter(`${ESC}[48;5;233m${ESC}[48;5;16m${ESC}[48;5;4m`)).toBe(`${ESC}[49m${ESC}[49m${ESC}[48;5;4m`)
    expect(filter(`${ESC}[48:2::10:10:10m`)).toBe(`${ESC}[49m`)
    // Foreground near-black is not a background.
    expect(filter(`${ESC}[38;2;10;10;10m`)).toBe(`${ESC}[38;2;10;10;10m`)
  })

  it('completes a sequence split across chunks', () => {
    const filter = createDarkBackgroundFilter()
    expect(filter(`a${ESC}[48;2;1`)).toBe('a')
    expect(filter(`0;10;10mb`)).toBe(`${ESC}[49mb`)
  })
})
