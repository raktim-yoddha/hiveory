import { describe, expect, it } from 'vitest'
import { annotationsText } from './annotations'

const element = (name: string, selector: string) => ({ ref: '@1', role: 'button', name, selector, text: '', html: '' })

describe('browser notes as a prompt', () => {
  it('asks for changes to be made and questions to be answered without changing anything, keeping the page numbers', () => {
    const text = annotationsText([
      { url: 'https://acme.dev/', element: element('Sign up', '#signup'), note: 'Make it green' },
      { url: 'https://acme.dev/', element: element('Price', '.price'), note: 'Why is this monthly?', intent: 'question' },
      { url: 'https://acme.dev/', element: element('Logo', '#logo'), note: 'Smaller', intent: 'change' }
    ])
    expect(text).toContain('Feedback on https://acme.dev/, numbered as marked on the page.')
    expect(text).toContain('Make these 2 changes:\n1. button "Sign up": Make it green\n   selector: #signup\n3. button "Logo": Smaller')
    expect(text).toContain('Answer this question from the code and the page. Do not change anything for it:\n2. button "Price": Why is this monthly?')
    expect(text).toContain('Check each change in the page with the hiveory browser tools. Answer each question by its number.')
    expect(text).not.toContain('page: ')
  })

  it('leaves out what was not asked, and says which page each note is on when they span pages', () => {
    const text = annotationsText([
      { url: 'https://acme.dev/a', element: element('A', '#a'), note: 'What is this?', intent: 'question' },
      { url: 'https://acme.dev/b', element: element('B', '#b'), note: 'Why?', intent: 'question' }
    ])
    expect(text).toContain('Feedback on 2 pages')
    expect(text).not.toContain('Make ')
    expect(text).toContain('   page: https://acme.dev/b')
  })
})
