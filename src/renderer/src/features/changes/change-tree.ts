import type { ChangedFile, ChangeSet } from '@shared/domain/changes'

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
  // Folders by path: searching a folder's children instead took seconds per thousand files in one folder.
  const folders = new Map<string, ChangeFolder>()
  for (const file of files) {
    const parts = file.path.split('/')
    let folder = root
    for (const part of parts.slice(0, -1)) {
      const path = folder.path ? `${folder.path}/${part}` : part
      let next = folders.get(path)
      if (!next) {
        next = { kind: 'folder', path, name: part, additions: 0, deletions: 0, children: [] }
        folders.set(path, next)
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

/** Every changed file, listed or not (ADR 0064 amendment). */
export const changedCount = (set: ChangeSet): number => set.files.length + (set.omitted ?? 0)

/** Said under a list that stops at the limit. */
export const omittedNote = (omitted: number): string =>
  `${omitted.toLocaleString()} more ${omitted === 1 ? 'file is' : 'files are'} not listed. Folders you don't keep in Git (dependencies, build output) belong in .gitignore.`

export { diffLines, shortCount, type DiffLine } from '@shared/domain/diff'
