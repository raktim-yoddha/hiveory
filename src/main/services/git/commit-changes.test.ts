import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { runProgram } from '../../../host/host-server'
import { gitOn } from './changes-service'
import { commitAll, discardFiles, pushBranch } from './commit-changes'

const hasGit = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

describe.skipIf(!hasGit)('commit, push and discard on a real repository (ADR 0060)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hv-commit-'))
  const repo = join(dir, 'repo')
  const origin = join(dir, 'origin.git')
  const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString()
  const git = (...args: string[]) => sh(repo, ...args)
  const read = (name: string) => readFileSync(join(repo, name), 'utf8').replace(/\r\n/g, '\n')
  mkdirSync(repo)
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'alex@example.com')
  git('config', 'user.name', 'Alex')
  git('config', 'core.autocrlf', 'false')
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  const run = gitOn({ exec: runProgram }, repo)

  it('refuses an empty message and an empty commit', async () => {
    await expect(commitAll(run, '   ')).rejects.toThrow(/commit message/)
    await expect(commitAll(run, 'nothing')).rejects.toThrow(/nothing to commit/)
  })

  it('makes the first commit, untracked files and odd names included', async () => {
    writeFileSync(join(repo, 'a.txt'), 'one\n')
    writeFileSync(join(repo, '-dash.txt'), 'looks like a flag\n')
    writeFileSync(join(repo, '[ab].txt'), 'looks like a pattern\n')
    const sha = await commitAll(run, 'start\n\nwith a body')
    expect(sha).toMatch(/^[0-9a-f]{40}$/)
    expect(git('log', '-1', '--format=%B').trim()).toBe('start\n\nwith a body')
    expect(git('status', '--porcelain')).toBe('')
  })

  it('discards edits, deletions, new files and renames, never ignored files', async () => {
    writeFileSync(join(repo, '.gitignore'), 'secret.env\n')
    await commitAll(run, 'ignore')
    writeFileSync(join(repo, 'secret.env'), 'kept\n')
    writeFileSync(join(repo, 'a.txt'), 'changed\n')
    rmSync(join(repo, '-dash.txt'))
    writeFileSync(join(repo, 'new.txt'), 'new\n')
    git('mv', '[ab].txt', 'moved.txt')
    // A pattern-looking name must only ever match itself.
    writeFileSync(join(repo, 'b.txt'), 'untouched\n')

    await discardFiles(run, ['a.txt', '-dash.txt', 'new.txt', '[ab].txt', 'moved.txt'])
    expect(read('a.txt')).toBe('one\n')
    expect(read('-dash.txt')).toBe('looks like a flag\n')
    expect(read('[ab].txt')).toBe('looks like a pattern\n')
    expect(existsSync(join(repo, 'new.txt'))).toBe(false)
    expect(existsSync(join(repo, 'moved.txt'))).toBe(false)
    expect(read('b.txt')).toBe('untouched\n')
    expect(read('secret.env')).toBe('kept\n')
    expect(git('status', '--porcelain')).toBe('?? b.txt\n')
    rmSync(join(repo, 'b.txt'))
  })

  it('refuses paths outside the repository', async () => {
    for (const bad of ['../outside.txt', 'sub/../../x', '/etc/passwd', 'C:\\x.txt', '\\\\server\\x', 'a\\..\\..\\x', '']) {
      await expect(discardFiles(run, [bad])).rejects.toThrow(/not inside this worktree/)
    }
  })

  it('works from a folder inside the repository', async () => {
    mkdirSync(join(repo, 'sub'), { recursive: true })
    writeFileSync(join(repo, 'sub', 'inner.txt'), 'x\n')
    writeFileSync(join(repo, 'a.txt'), 'from below\n')
    const below = gitOn({ exec: runProgram }, join(repo, 'sub'))
    await discardFiles(below, ['a.txt'])
    expect(read('a.txt')).toBe('one\n')
    await commitAll(below, 'inner')
    expect(git('show', '--name-only', '--format=', 'HEAD').trim()).toBe('sub/inner.txt')
  })

  it('says there is no origin, then pushes and tracks it', async () => {
    await expect(pushBranch(run)).rejects.toThrow(/no "origin" remote/)
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin])
    git('remote', 'add', 'origin', origin)
    expect(await pushBranch(run)).toEqual({ branch: 'main', upstream: 'origin/main' })
    expect(sh(origin, 'log', '-1', '--format=%s', 'main').trim()).toBe('inner')
    writeFileSync(join(repo, 'b.txt'), 'two\n')
    await commitAll(run, 'second')
    expect(await pushBranch(run)).toEqual({ branch: 'main', upstream: 'origin/main' })
    expect(sh(origin, 'log', '-1', '--format=%s', 'main').trim()).toBe('second')
  })

  it("explains a rejected push and a detached HEAD", async () => {
    // Someone else pushed first.
    const other = join(dir, 'other')
    execFileSync('git', ['clone', '-q', origin, other])
    sh(other, 'config', 'user.email', 'sam@example.com')
    sh(other, 'config', 'user.name', 'Sam')
    writeFileSync(join(other, 'c.txt'), 'theirs\n')
    sh(other, 'add', '-A')
    sh(other, 'commit', '-q', '-m', 'theirs')
    sh(other, 'push', '-q')
    writeFileSync(join(repo, 'd.txt'), 'mine\n')
    await commitAll(run, 'mine')
    await expect(pushBranch(run)).rejects.toMatchObject({ error: { hint: expect.stringMatching(/pull/) } })
    git('checkout', '-q', '--detach')
    await expect(pushBranch(run)).rejects.toThrow(/not on a branch/)
    git('checkout', '-q', 'main')
  })
})
