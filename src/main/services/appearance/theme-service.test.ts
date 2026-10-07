import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { parseJsonc, ThemeService } from './theme-service'

/** A minimal .zip: every entry deflated, with local headers and a central directory. */
const zip = (files: Record<string, string>): Buffer => {
  const locals: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text)
    const data = deflateRawSync(raw)
    const nameBuf = Buffer.from(name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(8, 10)
    entry.writeUInt32LE(data.length, 20)
    entry.writeUInt32LE(raw.length, 24)
    entry.writeUInt16LE(nameBuf.length, 28)
    entry.writeUInt32LE(offset, 42)
    locals.push(local, nameBuf, data)
    central.push(entry, nameBuf)
    offset += 30 + nameBuf.length + data.length
  }
  const dir = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(dir.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, dir, end])
}

const INFO = { id: 'acme.night', displayName: 'Night', publisher: 'acme', version: '1.0.0' }

describe('parseJsonc', () => {
  it('reads comments and trailing commas, keeping // inside strings', () => {
    expect(parseJsonc('{\n // c\n "a": "http://x", /* b */ "b": [1, 2,],\n}')).toEqual({ a: 'http://x', b: [1, 2] })
  })
})

describe('ThemeService', () => {
  let dir = ''
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }))

  it('reads every color theme in a .vsix, resolving includes', () => {
    const service = new ThemeService('unused')
    const vsix = zip({
      'extension/package.json': JSON.stringify({
        contributes: {
          themes: [
            { label: 'Night', uiTheme: 'vs-dark', path: './themes/night.json' },
            { label: 'Day', uiTheme: 'vs', path: './themes/day.json' },
            { label: 'Escape', uiTheme: 'vs', path: '../../evil.json' }
          ]
        }
      }),
      'extension/themes/base.json': '{ "colors": { "editor.background": "#101010", "foreground": "#eeeeee" }, }',
      'extension/themes/night.json': '// night\n{ "include": "./base.json", "colors": { "foreground": "#dddddd" } }',
      'extension/themes/day.json': '{ "colors": { "editor.background": "#fafafa" } }'
    })
    const extension = service.fromVsix(vsix, INFO)
    expect(extension.themes.map((t) => [t.id, t.kind])).toEqual([
      ['acme.night/night', 'dark'],
      ['acme.night/day', 'light']
    ])
    expect(extension.themes[0]!.tokens['base-surface']).toBe('#101010')
    expect(extension.themes[0]!.tokens['color-text']).toBe('#dddddd')
  })

  it('rejects an extension without color themes', () => {
    const vsix = zip({ 'extension/package.json': JSON.stringify({ contributes: { iconThemes: [{ id: 'x', path: 'x.json' }] } }) })
    expect(() => new ThemeService('unused').fromVsix(vsix, INFO)).toThrow(/no color themes/)
  })

  it('installs from Open VSX, lists, finds and removes', async () => {
    dir = mkdtempSync(join(tmpdir(), 'hv-themes-'))
    const vsix = zip({
      'extension/package.json': JSON.stringify({ contributes: { themes: [{ label: 'Night', uiTheme: 'vs-dark', path: 'night.json' }] } }),
      'extension/night.json': '{ "colors": { "editor.background": "#101010" } }'
    })
    const http = (async (url: string) => {
      if (url === 'https://open-vsx.org/api/acme/night')
        return new Response(JSON.stringify({ displayName: 'Night', version: '1.0.0', files: { download: 'https://open-vsx.org/api/acme/night/1.0.0/file/x.vsix' } }))
      if (url.endsWith('.vsix')) return Object.defineProperty(new Response(vsix), 'url', { value: 'https://openvsx.eclipsecontent.org/x.vsix' })
      return new Response('', { status: 404 })
    }) as typeof fetch
    const service = new ThemeService(dir, http)
    await service.install('acme', 'night')
    expect(service.list().map((e) => e.id)).toEqual(['acme.night'])
    expect(service.theme('acme.night/night')?.chrome.background).toMatch(/^#/)
    service.remove('acme.night')
    expect(service.list()).toEqual([])
    await expect(service.install('../x', 'night')).rejects.toThrow(/Unknown extension/)
  })
})
