import { describe, expect, it } from 'vitest'
import { annotationsText } from './annotations'

const element = (name: string, selector: string) => ({ ref: '@1', role: 'button', name, selector, text: '', html: '' })

describe('browser notes for an agent', () => {
  it('numbers the notes as on the page, with what each asks and where it is', () => {
    const text = annotationsText([
      { url: 'https://acme.dev/', element: element('Sign up', '#signup'), note: 'Make it green' },
      { url: 'https://acme.dev/', element: element('Price', '.price'), note: 'Why is this monthly?', intent: 'question' }
    ])
    expect(text).toContain('Feedback on https://acme.dev/ — 2 notes')
    expect(text).toContain('1. [change] button "Sign up": Make it green\n   selector: #signup')
    expect(text).toContain('2. [question] button "Price": Why is this monthly?')
    expect(text).not.toContain('page: ')
  })

  it('says which page each note is on when they span pages', () => {
    const text = annotationsText([
      { url: 'https://acme.dev/a', element: element('A', '#a'), note: 'x' },
      { url: 'https://acme.dev/b', element: element('B', '#b'), note: 'y' }
    ])
    expect(text).toContain('Feedback on 2 pages')
    expect(text).toContain('   page: https://acme.dev/b')
  })
})
