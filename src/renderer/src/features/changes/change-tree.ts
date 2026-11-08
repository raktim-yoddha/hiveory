import type { ChangedFile } from '@shared/domain/changes'

export interface ChangeFolder {
  kind: 'folder'
  /** Its path from the top, '/'-separated; folders with one child folder are joined ("src/app"). */
  path: string
  name: string
  additions: number
  deletions: number
  children: ChangeNode[]
}

export interface ChangeLeaf {
  kind: 'file'
  name: string
  file: ChangedFile
}

export type ChangeNode = ChangeFolder | ChangeLeaf

/**
 * The Changes tab's tree (ADR 0058): files under their folders, each folder with its summed counts,
 * folders first, and a chain of single-folder folders shown as one row, as code review tools do.
 */
export const buildChangeTree = (files: ChangedFile[]): ChangeNode[] => {
  const root: ChangeFolder = { kind: 'folder', path: '', name: '', additions: 0, deletions: 0, children: [] }
  for (const file of files) {
    const parts = file.path.split('/')
    let folder = root
    for (const part of parts.slice(0, -1)) {
      const path = folder.path ? `${folder.path}/${part}` : part
      let next = folder.children.find((c): c is ChangeFolder => c.kind === 'folder' && c.path === path)
      if (!next) {
        next = { kind: 'folder', path, name: part, additions: 0, deletions: 0, children: [] }
        folder.children.push(next)
      }
      folder = next
    }
    folder.children.push({ kind: 'file', name: parts.at(-1) ?? file.path, file })
  }
  const finish = (folder: ChangeFolder): ChangeFolder => {
    folder.children = folder.children.map((c) => (c.kind === 'folder' ? finish(c) : c))
    folder.additions = folder.children.reduce((n, c) => n + (c.kind === 'folder' ? c.additions : c.file.additions), 0)
    folder.deletions = folder.children.reduce((n, c) => n + (c.kind === 'folder' ? c.deletions : c.file.deletions), 0)
    // A folder holding only one folder is shown as one row.
    const only = folder.children[0]
    if (folder !== root && folder.children.length === 1 && only?.kind === 'folder') return { ...only, name: `${folder.name}/${only.name}` }
    folder.children.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'folder' ? -1 : 1))
    return folder
  }
  return finish(root).children
}

export type DiffLine = { kind: 'hunk' | 'add' | 'del' | 'context' | 'note'; text: string }

/** A unified diff's body as lines to color: headers dropped, hunks kept as separators. */
export const diffLines = (patch: string): DiffLine[] => {
  const lines: DiffLine[] = []
  let body = false
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith('@@')) {
      body = true
      lines.push({ kind: 'hunk', text: line })
    } else if (!body) {
      if (line.startsWith('Binary files')) lines.push({ kind: 'note', text: 'Binary file' })
    } else if (line.startsWith('diff --git')) body = false
    else if (line.startsWith('+')) lines.push({ kind: 'add', text: line.slice(1) })
    else if (line.startsWith('-')) lines.push({ kind: 'del', text: line.slice(1) })
    else if (line.startsWith('\\')) lines.push({ kind: 'note', text: line.slice(2) })
    else if (line) lines.push({ kind: 'context', text: line.slice(1) })
  }
  return lines
}

/** "1.9k" for counts past a thousand, as diff stats are usually shown. */
export const shortCount = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, '')}k` : String(n))
