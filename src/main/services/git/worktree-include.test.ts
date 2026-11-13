import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { GitService } from './git-service'
import { WorktreeService } from './worktree-service'

const hasGit = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

describe.skipIf(!hasGit)('.worktreeinclude copies git-ignored files into new worktrees (ADR 0061 amendment)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hv-include-'))
  const repo = join(dir, 'repo')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString()
  const write = (name: string, text: string) => {
    mkdirSync(join(repo, name, '..'), { recursive: true })
    writeFileSync(join(repo, name), text)
  }
  mkdirSync(repo)
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'alex@example.com')
  git('config', 'user.name', 'Alex')
  write('.gitignore', '.env\n.env.local\nconfig/local.json\nbuild/\n')
  write('README.md', 'demo\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'init')
  write('.env', 'TOKEN=one\n')
  write('.env.local', 'LOCAL=1\n')
  write('config/local.json', '{}\n')
  write('build/out.js', 'built\n')
  write('notes.txt', 'work in progress\n')
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  const worktrees = new WorktreeService(new GitService())

  it('copies nothing without the file', async () => {
    const path = join(dir, 'wt-none')
    await worktrees.create({ repoRoot: repo, path, branch: 'none', baseRef: 'main' })
    expect(existsSync(join(path, '.env'))).toBe(false)
  })

  it('copies the ignored files it names, and only those', async () => {
    // Patterns: a literal file, a glob, a folder path; notes.txt is untracked but not ignored; README is tracked.
    write('.worktreeinclude', '# local setup\n.env*\nconfig/local.json\nnotes.txt\nREADME.md\n')
    const path = join(dir, 'wt-some')
    await worktrees.create({ repoRoot: repo, path, branch: 'some', baseRef: 'main' })
    expect(readFileSync(join(path, '.env'), 'utf8')).toBe('TOKEN=one\n')
    expect(existsSync(join(path, '.env.local'))).toBe(true)
    expect(existsSync(join(path, 'config', 'local.json'))).toBe(true)
    expect(existsSync(join(path, 'notes.txt'))).toBe(false)
    expect(existsSync(join(path, 'build', 'out.js'))).toBe(false)
  })

  it('never overwrites a file the worktree already has', async () => {
    const path = join(dir, 'wt-some')
    writeFileSync(join(path, '.env'), 'TOKEN=mine\n')
    expect(await worktrees.copyIncluded(repo, path)).toBe(0)
    expect(readFileSync(join(path, '.env'), 'utf8')).toBe('TOKEN=mine\n')
  })
})
