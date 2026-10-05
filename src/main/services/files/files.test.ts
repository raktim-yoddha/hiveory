import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { listPanes } from '@shared/layout/operations'
import { locateGitBash } from '../cli/adapters/shells'
import { EditorService } from '../editors/editor-service'
import { LayoutService } from '../layout/layout-service'
import { StateStore } from '../persistence/state-store'
import { FileService } from './file-service'

const log = { info: () => undefined, warn: () => undefined, error: () => undefined }

const tree = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'hv-files-'))
  mkdirSync(join(root, 'src', 'lib'), { recursive: true })
  mkdirSync(join(root, '.git'))
  mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true })
  writeFileSync(join(root, 'README.md'), '# hi\n')
  writeFileSync(join(root, 'src', 'index.ts'), 'export {}\n')
  writeFileSync(join(root, 'src', 'lib', 'util.ts'), 'export const x = 1\n')
  writeFileSync(join(root, 'node_modules', 'pkg', 'util.ts'), '')
  writeFileSync(join(root, 'image.bin'), Buffer.from([0, 1, 2, 3]))
  return root
}

describe('file service', () => {
  const trashed: string[] = []
  const files = new FileService(async (p) => {
    trashed.push(p)
    rmSync(p, { recursive: true, force: true })
  })

  it('lists folders first, hides .git, and never leaves the folder', async () => {
    const root = tree()
    expect((await files.list(root, '')).map((e) => `${e.kind}:${e.name}`)).toEqual(['dir:node_modules', 'dir:src', 'file:image.bin', 'file:README.md'])
    expect((await files.list(root, 'src')).map((e) => e.path)).toEqual(['src/lib', 'src/index.ts'])
    await expect(files.list(root, '../')).rejects.toThrow(/outside/)
    expect(() => files.resolveIn(root, join(root, 'x'))).toThrow(/relative/)
    await expect(files.read(root, 'src/../../etc')).rejects.toThrow(/outside/)
  })

  it('refuses Git internals and links that lead out of the folder', async () => {
    const root = tree()
    await expect(files.write(root, '.git/hooks/pre-commit', 'x')).rejects.toThrow(/Git internals/)
    const outside = mkdtempSync(join(tmpdir(), 'hv-outside-'))
    writeFileSync(join(outside, 'secret.txt'), 'secret')
    // A junction needs no admin rights on Windows; elsewhere the type is ignored.
    symlinkSync(outside, join(root, 'escape'), 'junction')
    await expect(files.read(root, 'escape/secret.txt')).rejects.toThrow(/leads outside/)
    await expect(files.create(root, 'escape/new.txt', 'file')).rejects.toThrow(/leads outside/)
    expect(existsSync(join(outside, 'new.txt'))).toBe(false)
  })

  it('searches by path words, skipping heavy folders', async () => {
    const root = tree()
    expect((await files.search(root, 'util')).map((e) => e.path)).toEqual(['src/lib/util.ts'])
    expect((await files.search(root, 'src ts')).map((e) => e.path).sort()).toEqual(['src/index.ts', 'src/lib/util.ts'])
    expect(await files.search(root, '   ')).toEqual([])
  })

  it('reads text, refuses binaries, writes, creates, renames, pastes and trashes', async () => {
    const root = tree()
    expect((await files.read(root, 'README.md')).content).toBe('# hi\n')
    await expect(files.read(root, 'image.bin')).rejects.toThrow(/binary/)
    await files.write(root, 'README.md', 'changed')
    expect(readFileSync(join(root, 'README.md'), 'utf8')).toBe('changed')
    await files.create(root, 'docs/guide.md', 'file')
    await files.create(root, 'empty', 'dir')
    await expect(files.create(root, 'empty', 'dir')).rejects.toThrow(/already exists/)
    await files.rename(root, 'docs/guide.md', 'docs/intro.md')
    expect(existsSync(join(root, 'docs', 'intro.md'))).toBe(true)
    // Copy into the same folder gets " copy"; moving a folder into itself is refused.
    expect(await files.paste(root, ['README.md'], '', 'copy')).toEqual(['README copy.md'])
    expect(await files.paste(root, ['README.md'], '', 'copy')).toEqual(['README copy 2.md'])
    expect(await files.paste(root, ['README.md'], 'docs', 'move')).toEqual(['docs/README.md'])
    await expect(files.paste(root, ['src'], 'src/lib', 'move')).rejects.toThrow(/into itself/)
    await files.remove(root, ['docs'])
    expect(existsSync(join(root, 'docs'))).toBe(false)
    expect(trashed).toHaveLength(1)
    await expect(files.remove(root, [''])).rejects.toThrow(/cannot be deleted/)
  })
})

describe('editor panes', () => {
  it('opens one pane per file beside agents, follows renames and closes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hv-editors-'))
    const store = new StateStore(join(dir, 'state.json'), log)
    const events: string[] = []
    const emit = (_e: string, p: unknown) => void events.push((p as { topic: string }).topic)
    const layouts = new LayoutService(store, emit as never)
    const agents = ['a1']
    const editors: EditorService = new EditorService(store, layouts, (ws): string[] => [...agents, ...editors.ids(ws)], emit as never)
    layouts.set('w1', { type: 'pane', paneId: 'a1' })
    const first = editors.open('w1', 'src/index.ts', { targetPaneId: 'a1', side: 'right' })
    expect(first.name).toBe('index.ts')
    expect(editors.open('w1', 'src/index.ts').id).toBe(first.id)
    expect(listPanes(layouts.get('w1', [...agents, ...editors.ids('w1')]))).toEqual(['a1', first.id])
    editors.renamed('w1', 'src', 'lib')
    expect(editors.list('w1')[0]!.path).toBe('lib/index.ts')
    editors.close(first.id)
    expect(editors.list('w1')).toEqual([])
    expect(listPanes(store.state.layouts.w1 ?? null)).toEqual(['a1'])
    expect(events).toContain('editors')
  })
})

describe('shells', () => {
  it('finds Git Bash beside git.exe on Windows only', () => {
    const env = { platform: 'win32' as const, path: 'C:\\Git\\cmd', pathExt: '.EXE', isExecutable: (f: string) => f.toLowerCase() === 'c:\\git\\cmd\\git.exe' }
    expect(locateGitBash(env, (p) => p.toLowerCase() === 'c:\\git\\bin\\bash.exe')?.toLowerCase()).toBe('c:\\git\\bin\\bash.exe')
    expect(locateGitBash(env, () => false)).toBeUndefined()
    expect(locateGitBash({ ...env, platform: 'linux' }, () => true)).toBeUndefined()
  })
})
