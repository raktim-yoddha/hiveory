/** A link found in one terminal line: `start`/`end` are string indexes (end exclusive). */
export type TerminalLink =
  | { kind: 'url'; start: number; end: number; text: string; url: string }
  | { kind: 'file'; start: number; end: number; text: string; path: string; line?: number; col?: number }

const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/g
// A path: optional root (C:\, /, ./, ../, ~/), folders, then a name with an extension that starts with a
// letter (so versions like 1.2.3 are not files); then :line[:col], (line[,col]) or #Lline.
const FILE_RE =
  /(?<![\w/\\.@~-])((?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|~[\\/]|[\\/])?(?:[\w.@+-]+[\\/])*\.?[\w@+-][\w.@+-]*\.[A-Za-z][A-Za-z0-9]{0,9})(?::(\d+)(?::(\d+))?|\((\d+)(?:,\s?(\d+))?\)|#L(\d+))?/g

const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' }

/** Drops trailing punctuation and closing brackets the URL did not open (prose and Markdown wrap URLs). */
const trimUrl = (raw: string): string => {
  let url = raw
  for (;;) {
    const last = url.at(-1) ?? ''
    if (/[.,;:!?'"*]/.test(last)) url = url.slice(0, -1)
    else if (CLOSERS[last] && url.split(CLOSERS[last]).length <= url.split(last).length - 1) url = url.slice(0, -1)
    else return url
  }
}

const num = (s: string | undefined): number | undefined => (s ? Number(s) : undefined)

/**
 * URLs and file paths in a line of terminal output. A bare name counts as a file only when it looks like
 * one (a folder in it, or a name and extension of two letters or more), so "e.g." and "v1.2" stay text.
 */
export const findTerminalLinks = (line: string): TerminalLink[] => {
  const links: TerminalLink[] = []
  for (const m of line.matchAll(URL_RE)) {
    const url = trimUrl(m[0])
    if (url.length > 'https://'.length) links.push({ kind: 'url', start: m.index, end: m.index + url.length, text: url, url })
  }
  const inUrl = (i: number): boolean => links.some((l) => i >= l.start && i < l.end)
  for (const m of line.matchAll(FILE_RE)) {
    if (inUrl(m.index)) continue
    const path = m[1] ?? ''
    const hasFolder = /[\\/]/.test(path)
    const name = path.replace(/^.*[\\/]/, '')
    const dot = name.lastIndexOf('.')
    if (!hasFolder && (dot < 2 || name.length - dot - 1 < 2 || name.includes('@'))) continue
    links.push({ kind: 'file', start: m.index, end: m.index + m[0].length, text: m[0], path, line: num(m[2] ?? m[4] ?? m[6]), col: num(m[3] ?? m[5]) })
  }
  return links.sort((a, b) => a.start - b.start)
}

/**
 * A path from terminal output as a path inside the worktree at `root` (forward slashes), or null when it
 * points outside it: relative paths are read from the worktree, absolute ones must be under it.
 */
export const pathInWorktree = (path: string, root: string): string | null => {
  const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const windows = /^[A-Za-z]:\//.test(norm(root))
  const same = (a: string, b: string): boolean => (windows ? a.toLowerCase() === b.toLowerCase() : a === b)
  let p = norm(path)
  if (p.startsWith('~/')) return null
  const absolute = /^[A-Za-z]:\//.test(p) || p.startsWith('/')
  if (absolute) {
    const r = norm(root)
    if (!same(p.slice(0, r.length), r) || (p.length > r.length && p[r.length] !== '/')) return null
    p = p.slice(r.length + 1)
  }
  const parts: string[] = []
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (!parts.length) return null
      parts.pop()
    } else parts.push(part)
  }
  return parts.length ? parts.join('/') : null
}
