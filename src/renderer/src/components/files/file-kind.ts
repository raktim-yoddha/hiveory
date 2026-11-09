import { folderName } from '../../lib/folder-name'

/** How a file shows in lists (ADR 0065): which icon and which tint, from its name alone. */
export type FileGlyph = 'code' | 'json' | 'text' | 'image' | 'terminal' | 'config' | 'lock' | 'archive' | 'video' | 'audio' | 'container' | 'file'
export type FileTone = 'blue' | 'yellow' | 'orange' | 'purple' | 'green' | 'cyan' | 'red' | 'muted'

const BY_NAME: Record<string, [FileGlyph, FileTone]> = {
  'package-lock.json': ['lock', 'muted'],
  'pnpm-lock.yaml': ['lock', 'muted'],
  'yarn.lock': ['lock', 'muted'],
  'bun.lockb': ['lock', 'muted'],
  'cargo.lock': ['lock', 'muted'],
  dockerfile: ['container', 'cyan'],
  '.gitignore': ['config', 'muted'],
  '.gitattributes': ['config', 'muted'],
  '.env': ['config', 'yellow'],
  makefile: ['terminal', 'muted'],
  license: ['text', 'muted']
}

const BY_EXT: Record<string, [FileGlyph, FileTone]> = {
  ts: ['code', 'blue'], tsx: ['code', 'blue'], mts: ['code', 'blue'], cts: ['code', 'blue'],
  js: ['code', 'yellow'], jsx: ['code', 'yellow'], mjs: ['code', 'yellow'], cjs: ['code', 'yellow'],
  json: ['json', 'yellow'], jsonc: ['json', 'yellow'], json5: ['json', 'yellow'],
  md: ['text', 'blue'], mdx: ['text', 'blue'], txt: ['text', 'muted'], rst: ['text', 'muted'], pdf: ['text', 'red'],
  css: ['code', 'purple'], scss: ['code', 'purple'], sass: ['code', 'purple'], less: ['code', 'purple'],
  html: ['code', 'orange'], htm: ['code', 'orange'], xml: ['code', 'orange'], vue: ['code', 'green'], svelte: ['code', 'orange'],
  py: ['code', 'cyan'], go: ['code', 'cyan'], rs: ['code', 'orange'], java: ['code', 'red'], kt: ['code', 'purple'], rb: ['code', 'red'],
  php: ['code', 'purple'], c: ['code', 'blue'], h: ['code', 'blue'], cpp: ['code', 'blue'], hpp: ['code', 'blue'], cs: ['code', 'green'],
  swift: ['code', 'orange'], dart: ['code', 'cyan'], lua: ['code', 'blue'], sql: ['code', 'orange'],
  sh: ['terminal', 'green'], bash: ['terminal', 'green'], zsh: ['terminal', 'green'], fish: ['terminal', 'green'], ps1: ['terminal', 'blue'], bat: ['terminal', 'muted'], cmd: ['terminal', 'muted'],
  yml: ['config', 'red'], yaml: ['config', 'red'], toml: ['config', 'muted'], ini: ['config', 'muted'], conf: ['config', 'muted'], env: ['config', 'yellow'], lock: ['lock', 'muted'],
  png: ['image', 'green'], jpg: ['image', 'green'], jpeg: ['image', 'green'], gif: ['image', 'green'], webp: ['image', 'green'], svg: ['image', 'orange'], ico: ['image', 'green'], avif: ['image', 'green'], bmp: ['image', 'green'],
  zip: ['archive', 'muted'], tar: ['archive', 'muted'], gz: ['archive', 'muted'], tgz: ['archive', 'muted'], '7z': ['archive', 'muted'],
  mp4: ['video', 'purple'], mov: ['video', 'purple'], webm: ['video', 'purple'], mp3: ['audio', 'purple'], wav: ['audio', 'purple']
}

/** The icon and tint for a file name ("src/app.ts" or "app.ts"). */
export function fileKind(path: string): [FileGlyph, FileTone] {
  const name = folderName(path).toLowerCase()
  const named = BY_NAME[name]
  if (named) return named
  if (name.startsWith('.env')) return ['config', 'yellow']
  const dot = name.lastIndexOf('.')
  return (dot > 0 || (dot === 0 && name.length > 1) ? BY_EXT[name.slice(dot + 1)] : undefined) ?? ['file', 'muted']
}
