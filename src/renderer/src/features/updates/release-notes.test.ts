import { describe, expect, it } from 'vitest'
import { releaseHighlights } from './release-notes'

describe('release highlights', () => {
  it('reads the Highlights list as plain text', () => {
    const html =
      '<p><em>Banner</em></p><h3>Highlights</h3><ul><li>Terminal text <strong>zooms</strong> &amp; reflows.</li><li>Panes stay put.</li></ul>' +
      '<h3>Features</h3><ul><li>feat: x (abc)</li></ul>'
    expect(releaseHighlights(html)).toEqual(['Terminal text zooms & reflows.', 'Panes stay put.'])
  })

  it('falls back to the first list, caps the count, and never passes markup through', () => {
    const html = '<ul><li>a</li><li><script>b</script></li><li>c</li><li>d</li></ul>'
    expect(releaseHighlights(html)).toEqual(['a', 'b', 'c'])
    expect(releaseHighlights(undefined)).toEqual([])
    expect(releaseHighlights('<p>no list</p>')).toEqual([])
  })
})
