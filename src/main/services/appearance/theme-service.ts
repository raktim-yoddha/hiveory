import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, posix } from 'node:path'
import {
  THEME_EXTENSION_ID,
  THEME_SEGMENT,
  themeKind,
  themeSlug,
  themeTokens,
  type ThemeListing,
  type TokenColorRule,
  type VsCodeTheme,
  type VsCodeThemeExtension
} from '@shared/domain'
import { fail } from '@shared/errors'
import { readZip } from './zip'

type Fetch = typeof fetch

/** Open VSX: the open registry of VS Code extensions (the Microsoft marketplace is VS Code-only by its terms). */
export const OPEN_VSX = 'https://open-vsx.org'
const PAGE = 30
const MAX_VSIX_BYTES = 50 * 1024 * 1024
/** How deep a theme's `include` chain may go. */
const MAX_INCLUDES = 5

/** JSON with comments and trailing commas, as VS Code reads theme files. */
export const parseJsonc = (text: string): unknown => {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (c === '"') {
      const start = i
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++
      out += text.slice(start, i + 1)
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      out += '\n'
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2)
      if (i < 0) break
      i++
    } else out += c
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1').replace(/^\uFEFF/, ''))
}

const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {})

/**
 * VS Code color themes (ADR 0034): searched on Open VSX, downloaded as .vsix,
 * and kept only as Hiveory tokens — one small JSON file per extension. Nothing
 * from the package runs; its theme files are read as data.
 */
export class ThemeService {
  constructor(
    private readonly dir: string,
    private readonly http: Fetch = fetch
  ) {}

  private async json(url: string): Promise<Record<string, unknown>> {
    const res = await this.http(url, { headers: { accept: 'application/json' }, redirect: 'follow' }).catch(() => fail('UNEXPECTED', 'Could not reach Open VSX. Check your connection.'))
    if (!res.ok) fail(res.status === 404 ? 'NOT_FOUND' : 'UNEXPECTED', `Open VSX answered ${res.status}.`)
    return record(await res.json())
  }

  async search(query: string, offset: number): Promise<{ total: number; items: ThemeListing[] }> {
    const params = new URLSearchParams({ category: 'Themes', size: String(PAGE), offset: String(offset), sortBy: 'downloadCount', sortOrder: 'desc' })
    if (query) params.set('query', query)
    const data = await this.json(`${OPEN_VSX}/api/-/search?${params}`)
    const items = (Array.isArray(data.extensions) ? data.extensions : []).map(record).flatMap((e): ThemeListing[] => {
      const namespace = String(e.namespace ?? '')
      const name = String(e.name ?? '')
      if (!THEME_SEGMENT.test(namespace) || !THEME_SEGMENT.test(name)) return []
      const icon = String(record(e.files).icon ?? '')
      return [
        {
          id: `${namespace}.${name}`,
          namespace,
          name,
          displayName: String(e.displayName || name).slice(0, 120),
          description: String(e.description ?? '').slice(0, 300),
          version: String(e.version ?? '').slice(0, 40),
          downloads: Number(e.downloadCount) || 0,
          icon: icon.startsWith(`${OPEN_VSX}/`) ? icon : null
        }
      ]
    })
    return { total: Number(data.totalSize) || items.length, items }
  }

  list(): VsCodeThemeExtension[] {
    let files: string[]
    try {
      files = readdirSync(this.dir)
    } catch {
      return []
    }
    return files
      .filter((f) => f.endsWith('.json') && THEME_EXTENSION_ID.test(f.slice(0, -5)))
      .flatMap((f) => {
        try {
          return [JSON.parse(readFileSync(join(this.dir, f), 'utf8')) as VsCodeThemeExtension]
        } catch {
          return []
        }
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
  }

  theme(id: string): VsCodeTheme | null {
    if (!id) return null
    const extension = id.split('/')[0]!
    return this.list().find((e) => e.id === extension)?.themes.find((t) => t.id === id) ?? null
  }

  async install(namespace: string, name: string): Promise<VsCodeThemeExtension> {
    if (!THEME_SEGMENT.test(namespace) || !THEME_SEGMENT.test(name)) fail('INVALID_INPUT', 'Unknown extension.')
    // The download address comes from Open VSX itself, never from the renderer.
    const meta = await this.json(`${OPEN_VSX}/api/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`)
    const download = String(record(meta.files).download ?? '')
    if (!download.startsWith(`${OPEN_VSX}/`)) fail('UNEXPECTED', 'Open VSX did not offer a download for this extension.')
    const res = await this.http(download, { redirect: 'follow' }).catch(() => fail('UNEXPECTED', 'Could not download the extension.'))
    if (!res.ok || !res.url.startsWith('https://')) fail('UNEXPECTED', `Download failed (${res.status}).`)
    if (Number(res.headers.get('content-length')) > MAX_VSIX_BYTES) fail('INVALID_INPUT', 'That extension is larger than 50 MB.')
    const bytes = Buffer.from(await res.arrayBuffer())
    if (bytes.length > MAX_VSIX_BYTES) fail('INVALID_INPUT', 'That extension is larger than 50 MB.')
    const extension = this.fromVsix(bytes, {
      id: `${namespace}.${name}`,
      displayName: String(meta.displayName || name).slice(0, 120),
      publisher: namespace,
      version: String(meta.version ?? '').slice(0, 40)
    })
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(join(this.dir, `${extension.id}.json`), JSON.stringify(extension))
    return extension
  }

  /** Reads every color theme a .vsix contributes; icon and product-icon themes are not color themes. */
  fromVsix(bytes: Buffer, info: Omit<VsCodeThemeExtension, 'themes'>): VsCodeThemeExtension {
    const zip = readZip(bytes)
    const read = (path: string): string => {
      const entry = zip.get(path)
      if (!entry) return fail('INVALID_INPUT', `The extension is missing ${path}.`)
      return entry().toString('utf8')
    }
    const manifest = record(parseJsonc(read('extension/package.json')))
    const contributed = (Array.isArray(record(manifest.contributes).themes) ? (record(manifest.contributes).themes as unknown[]) : []).map(record)
    const themes: VsCodeTheme[] = []
    const ids = new Set<string>()
    for (const entry of contributed) {
      const path = typeof entry.path === 'string' ? posix.normalize(posix.join('extension', entry.path)) : ''
      if (!path.startsWith('extension/') || !path.toLowerCase().endsWith('.json')) continue
      try {
        const { colors, tokenColors, type } = this.load(read, path, 0)
        const label = String(entry.label || entry.id || posix.basename(path, '.json')).slice(0, 120)
        let slug = themeSlug(label)
        for (let n = 2; ids.has(slug); n++) slug = `${themeSlug(label).slice(0, 76)}-${n}`
        ids.add(slug)
        const kind = themeKind(entry.uiTheme ?? type)
        themes.push({ id: `${info.id}/${slug}`, label, kind, ...themeTokens(colors, tokenColors, kind) })
      } catch {
        // One broken theme file doesn't sink its siblings.
      }
    }
    if (!themes.length) fail('INVALID_INPUT', 'This extension has no color themes Hiveory can read (it may be an icon theme).')
    return { ...info, themes }
  }

  /** A theme file with its `include` chain resolved: the including file's colors win. */
  private load(read: (path: string) => string, path: string, depth: number): { colors: Record<string, unknown>; tokenColors: TokenColorRule[]; type: unknown } {
    const file = record(parseJsonc(read(path)))
    let base: { colors: Record<string, unknown>; tokenColors: TokenColorRule[]; type: unknown } = { colors: {}, tokenColors: [], type: undefined }
    if (typeof file.include === 'string' && depth < MAX_INCLUDES) {
      const next = posix.normalize(posix.join(posix.dirname(path), file.include))
      if (next.startsWith('extension/') && next.toLowerCase().endsWith('.json')) base = this.load(read, next, depth + 1)
    }
    // A tokenColors path points at a .tmTheme (plist); only inline rules are read.
    const rules = Array.isArray(file.tokenColors) ? (file.tokenColors as TokenColorRule[]) : []
    return { colors: { ...base.colors, ...record(file.colors) }, tokenColors: [...base.tokenColors, ...rules], type: file.type ?? base.type }
  }

  remove(id: string): void {
    if (!THEME_EXTENSION_ID.test(id)) fail('INVALID_INPUT', 'Unknown theme.')
    try {
      unlinkSync(join(this.dir, `${id}.json`))
    } catch {
      // Already gone.
    }
  }
}
