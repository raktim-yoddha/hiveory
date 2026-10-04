import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AppException } from '@shared/errors'
import { GitService } from './git/git-service'
import { WorktreeService } from './git/worktree-service'
import { PtySession } from './pty/pty-session'

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim()
const repo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'hv-int-'))
  git(dir, 'init', '-b', 'main')
  git(dir, 'config', 'user.email', 'test@example.test')
  git(dir, 'config', 'user.name', 'test')
  writeFileSync(join(dir, 'a.txt'), 'a')
  git(dir, 'add', '.')
  git(dir, 'commit', '-m', 'init')
  git(dir, 'branch', 'develop')
  return dir
}
const code = async (p: Promise<unknown>) => {
  try {
    await p
    return 'ok'
  } catch (e) {
    return e instanceof AppException ? e.error.code : 'other'
  }
}

describe('real git worktree lifecycle', () => {
  const g = new GitService()
  const wt = new WorktreeService(g)

  it('creates, inspects, protects and removes isolated worktrees', async () => {
    const root = repo()
    const base = mkdtempSync(join(tmpdir(), 'hv-wt-'))
    const path = join(base, 'one')

    expect(await g.defaultBranch(root)).toBe('main')
    expect((await g.localBranches(root)).sort()).toEqual(['develop', 'main'])
    expect(await g.refExists(root, 'develop')).toBe(true)
    expect(await g.refExists(root, 'nope')).toBe(false)
    expect(await g.branchNameProblem(root, 'hiveory/one')).toBeNull()
    expect(await g.branchNameProblem(root, 'bad..name')).not.toBeNull()

    await wt.create({ repoRoot: root, path, branch: 'hiveory/one', baseRef: 'develop' })
    expect(existsSync(join(path, 'a.txt'))).toBe(true)
    expect((await g.status(path))?.branch).toBe('hiveory/one')
    expect((await wt.list(root)).map((w) => w.branch)).toContain('hiveory/one')

    // Dirty worktrees need an explicit force.
    writeFileSync(join(path, 'b.txt'), 'b')
    expect((await g.status(path))?.untracked).toBe(1)
    expect(await code(wt.remove(root, path, false))).toBe('WORKTREE_DIRTY')
    await wt.remove(root, path, true)
    expect(existsSync(path)).toBe(false)
    // Merged (no new commits) branches are cleaned up.
    expect(await wt.deleteBranchIfMerged(root, 'hiveory/one')).toBe(true)
  })

  it('checks out existing branches, refuses ones already in use, and keeps unmerged work', async () => {
    const root = repo()
    const base = mkdtempSync(join(tmpdir(), 'hv-wt-'))
    await wt.create({ repoRoot: root, path: join(base, 'dev'), branch: 'develop' })
    expect((await g.status(join(base, 'dev')))?.branch).toBe('develop')
    const err = await wt.create({ repoRoot: root, path: join(base, 'dev2'), branch: 'develop' }).catch((e) => e)
    expect(err).toBeInstanceOf(AppException)
    expect((err as AppException).error.message).toMatch(/already checked out/)

    await wt.create({ repoRoot: root, path: join(base, 'work'), branch: 'hiveory/work', baseRef: 'main' })
    writeFileSync(join(base, 'work', 'c.txt'), 'c')
    git(join(base, 'work'), 'add', '.')
    git(join(base, 'work'), 'commit', '-m', 'work')
    await wt.remove(root, join(base, 'work'), false)
    expect(await wt.deleteBranchIfMerged(root, 'hiveory/work')).toBe(false)
  })

  it('rebuilds a worktree whose folder was deleted', async () => {
    const root = repo()
    const path = join(mkdtempSync(join(tmpdir(), 'hv-wt-')), 'gone')
    await wt.create({ repoRoot: root, path, branch: 'hiveory/gone', baseRef: 'main' })
    rmSync(path, { recursive: true, force: true })
    await wt.recreate(root, path, 'hiveory/gone')
    expect((await g.status(path))?.branch).toBe('hiveory/gone')
  })

  it('initializes a plain folder with a first commit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hv-plain-'))
    writeFileSync(join(dir, 'x.txt'), 'x')
    expect(await g.repositoryRoot(dir)).toBeUndefined()
    git(dir, 'init', '-b', 'main')
    git(dir, 'config', 'user.email', 'test@example.test')
    git(dir, 'config', 'user.name', 'test')
    await g.init(dir, true)
    expect(await g.hasCommits(dir)).toBe(true)
  })
})

describe('real PTY session', () => {
  const echo = process.platform === 'win32' ? { file: 'cmd.exe', args: ['/d', '/c', 'echo hiveory-ok'] } : { file: '/bin/echo', args: ['hiveory-ok'] }

  it('spawns at the reported size, mirrors the screen and reports exit', async () => {
    const pty = new PtySession(true)
    const exited = new Promise<number | null>((resolve) => pty.on('exit', (code) => resolve(code)))
    const output: string[] = []
    pty.on('data', (d) => output.push(d))
    const cwd = mkdtempSync(join(tmpdir(), 'hv-pty-'))
    mkdirSync(cwd, { recursive: true })
    pty.start({ ...echo, cwd, env: { ...process.env } as Record<string, string> })
    expect(pty.hasProcess).toBe(false) // waits for a size
    pty.resize(80, 20)
    expect(pty.hasProcess).toBe(true)
    expect(await exited).toBe(0)
    await new Promise((r) => setTimeout(r, 50))
    expect(output.join('')).toContain('hiveory-ok')
    expect(pty.screenText(20)).toContain('hiveory-ok')
    expect(pty.snapshot().data).toContain('hiveory-ok')
    pty.killNow()
  }, 20_000)

  it('spawns after the fallback delay when no size ever arrives', async () => {
    const pty = new PtySession(false)
    const exited = new Promise<number | null>((resolve) => pty.on('exit', (code) => resolve(code)))
    pty.start({ ...echo, cwd: tmpdir(), env: { ...process.env } as Record<string, string> })
    expect(await exited).toBe(0)
  }, 20_000)
})
