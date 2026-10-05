import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { WallpaperImage } from '@shared/ipc/contract'
import { fail } from '@shared/errors'

/** Electron's nativeImage, narrowed to what this needs (a stand-in in tests). */
export interface ImageCodec {
  createFromPath(path: string): {
    isEmpty(): boolean
    getSize(): { width: number; height: number }
    resize(options: { width: number; quality?: 'good' | 'better' | 'best' }): { toJPEG(quality: number): Buffer }
    toJPEG(quality: number): Buffer
  }
}

export const WALLPAPER_SCHEME = 'hv-wallpaper'
export const WALLPAPER_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif']
const FILE = /^[wt]-[a-f0-9]{12}\.(?:jpg|jpeg|png|webp|gif|avif)$/
/** Wider images are scaled down: a 6K photo would cost ~100 MB of decoded memory for no visible gain. */
const MAX_WIDTH = 2560
const THUMB_WIDTH = 480
const MAX_BYTES = 40 * 1024 * 1024

const url = (file: string): string => `${WALLPAPER_SCHEME}://img/${file}`

/**
 * Wallpapers the user adds. Each image is copied into Hiveory's own folder
 * (downscaled when large, plus a small thumbnail), so the original can move
 * and the renderer only ever loads files from here via `hv-wallpaper://`.
 */
export class WallpaperService {
  constructor(
    private readonly dir: string,
    private readonly codec: ImageCodec
  ) {}

  list(): WallpaperImage[] {
    let files: string[]
    try {
      files = readdirSync(this.dir)
    } catch {
      return []
    }
    return files
      .filter((f) => FILE.test(f) && f.startsWith('w-'))
      .map((file) => ({ file, mtime: statSync(join(this.dir, file)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .map(({ file }) => this.describe(file))
  }

  private describe(file: string): WallpaperImage {
    const thumb = `t-${file.slice(2, 14)}.jpg`
    return { file, url: url(file), thumb: url(existsSync(join(this.dir, thumb)) ? thumb : file) }
  }

  add(source: string): WallpaperImage {
    const ext = extname(source).slice(1).toLowerCase()
    if (!WALLPAPER_EXTENSIONS.includes(ext)) fail('INVALID_INPUT', `Choose an image (${WALLPAPER_EXTENSIONS.join(', ')}).`)
    if (statSync(source).size > MAX_BYTES) fail('INVALID_INPUT', 'That image is larger than 40 MB.')
    mkdirSync(this.dir, { recursive: true })
    const id = createHash('sha1').update(readFileSync(source)).digest('hex').slice(0, 12)
    const image = this.codec.createFromPath(source)
    if (image.isEmpty()) {
      // Formats the codec can't decode (WebP, GIF, AVIF) are kept as they are; Chromium shows them.
      const file = `w-${id}.${ext}`
      copyFileSync(source, join(this.dir, file))
      return this.describe(file)
    }
    const { width } = image.getSize()
    const file = `w-${id}.jpg`
    writeFileSync(join(this.dir, file), width > MAX_WIDTH ? image.resize({ width: MAX_WIDTH, quality: 'best' }).toJPEG(88) : image.toJPEG(92))
    writeFileSync(join(this.dir, `t-${id}.jpg`), image.resize({ width: Math.min(THUMB_WIDTH, width), quality: 'good' }).toJPEG(80))
    return this.describe(file)
  }

  remove(file: string): void {
    if (!FILE.test(file)) fail('INVALID_INPUT', 'Unknown wallpaper.')
    for (const name of [file, `t-${file.slice(2, 14)}.jpg`]) {
      try {
        unlinkSync(join(this.dir, name))
      } catch {
        // Already gone.
      }
    }
  }

  /** The file behind an `hv-wallpaper://img/<file>` request, or null for anything else. */
  resolve(requestUrl: string): string | null {
    try {
      const { hostname, pathname } = new URL(requestUrl)
      const file = decodeURIComponent(pathname.replace(/^\//, ''))
      if (hostname !== 'img' || !FILE.test(file)) return null
      const path = join(this.dir, file)
      return existsSync(path) ? path : null
    } catch {
      return null
    }
  }
}
