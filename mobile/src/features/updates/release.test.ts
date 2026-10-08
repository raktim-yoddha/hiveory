import { describe, expect, it } from 'vitest'
import { highlightsOf, isNewer, parseRelease } from './release'

describe('phone updates', () => {
  it('offers only a higher stable version', () => {
    expect(isNewer('0.22.0', '0.21.0')).toBe(true)
    expect(isNewer('v0.21.1', '0.21.0')).toBe(true)
    expect(isNewer('1.0.0', '0.99.99')).toBe(true)
    expect(isNewer('0.21.0', '0.21.0')).toBe(false)
    expect(isNewer('0.20.9', '0.21.0')).toBe(false)
    expect(isNewer('0.22.0-beta.1', '0.21.0')).toBe(false)
    expect(isNewer('nonsense', '0.21.0')).toBe(false)
  })

  it('reads the Highlights bullets as plain text', () => {
    const body = '_Banner_\n\n### Highlights\n- Terminal text **zooms**.\n- Panes stay put.\n\n### Features\n- feat: x (abc)\n'
    expect(highlightsOf(body)).toEqual(['Terminal text zooms.', 'Panes stay put.'])
    expect(highlightsOf('no highlights here')).toEqual([])
  })

  it('points at the APK, else the release page, and only on github.com', () => {
    const base = { tag_name: 'v0.22.0', body: '', html_url: 'https://github.com/raktim-yoddha/hiveory/releases/tag/v0.22.0' }
    const apk = 'https://github.com/raktim-yoddha/hiveory/releases/download/v0.22.0/Hiveory-0.22.0.apk'
    expect(parseRelease({ ...base, assets: [{ name: 'Hiveory-Setup-0.22.0.exe', browser_download_url: 'x' }, { name: 'Hiveory-0.22.0.apk', browser_download_url: apk }] })).toEqual({
      version: '0.22.0',
      highlights: [],
      url: apk
    })
    expect(parseRelease({ ...base, assets: [] })?.url).toBe(base.html_url)
    expect(parseRelease({ ...base, html_url: 'https://evil.example/x', assets: [] })).toBeNull()
    expect(parseRelease({ ...base, prerelease: true })).toBeNull()
    expect(parseRelease(null)).toBeNull()
  })
})
