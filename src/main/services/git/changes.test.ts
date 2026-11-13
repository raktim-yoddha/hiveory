import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { runProgram } from '../../../host/host-server'
import { Checkpoints } from '../chat/checkpoints'
import { claudeParser, codexParser, toTasks } from '../chat/parsers'
import { parseClaudeCommands } from '../chat/providers'
import { gitOn } from './changes-service'
import { countNewFile, listed, MAX_LISTED_FILES, mergeChanges, parseLog, parseNameStatus, parseNumstat, WorktreeChanges } from './changes'

describe('git change parsing (ADR 0058)', () => {
  it('joins name-status and numstat, renames and binaries included', () => {
    const names = parseNameStatus('M\0src/a.ts\0R087\0old/b.ts\0new/b.ts\0A\0img.png\0D\0gone.md\0')
    const counts = parseNumstat('3\t1\tsrc/a.ts\0' + '2\t2\t\0old/b.ts\0new/b.ts\0' + '-\t-\timg.png\0' + '0\t7\tgone.md\0')
    expect(mergeChanges(names, counts)).toEqual([
      { path: 'gone.md', status: 'deleted', additions: 0, deletions: 7 },
      { path: 'img.png', status: 'added', additions: 0, deletions: 0, binary: true },
      { path: 'new/b.ts', from: 'old/b.ts', status: 'renamed', additions: 2, deletions: 2 },
      { path: 'src/a.ts', status: 'modified', additions: 3, deletions: 1 }
    ])
  })

  it('reads the log format', () => {
    expect(parseLog('abc\x1ffix it\x1fAlex\x1f2026-01-02T03:04:05Z\x1e\n')).toEqual([{ sha: 'abc', subject: 'fix it', author: 'Alex', date: '2026-01-02T03:04:05Z' }])
  })
})

describe('agent task lists, usage and commands (ADR 0058)', () => {
  it("reads Claude's TodoWrite and context use", () => {
    const parse = claudeParser()
    const events = parse(
      JSON.stringify({
        type: 'assistant',
        message: {
          id: 'm1',
          content: [{ type: 'tool_use', id: 't1', name: 'TodoWrite', input: { todos: [{ content: 'Write tests', status: 'completed' }, { content: 'Ship', status: 'in_progress' }] } }],
          usage: { input_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 90, output_tokens: 20 }
        }
      })
    )
    expect(events).toContainEqual({ type: 'tasks', tasks: [{ text: 'Write tests', status: 'completed' }, { text: 'Ship', status: 'in_progress' }] })
    expect(events).toContainEqual({ type: 'usage', used: 1120 })
    expect(parse(JSON.stringify({ type: 'result', modelUsage: { opus: { contextWindow: 200000 } } }))).toContainEqual({ type: 'usage', window: 200000 })
  })

  it("reads Codex's plan", () => {
    const events = codexParser()(JSON.stringify({ type: 'item.updated', item: { id: 'i1', type: 'todo_list', items: [{ text: 'a', completed: true }, { text: 'b', completed: false }] } }))
    expect(events).toEqual([{ type: 'tasks', tasks: [{ text: 'a', status: 'completed' }, { text: 'b', status: 'pending' }] }])
    expect(toTasks([])).toBeUndefined()
  })

  it("lists Claude's slash commands", () => {
    expect(parseClaudeCommands([{ name: 'review', description: 'Review a PR', argumentHint: '<pr>' }, { name: '' }, 'x'])).toEqual([
      { name: 'review', description: 'Review a PR', argumentHint: '<pr>' }
    ])
  })
})

const hasGit = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

describe.skipIf(!hasGit)('turn checkpoints on a real repository (ADR 0058)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hv-checkpoint-'))
  const repo = join(dir, 'repo')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString()
  mkdirSync(repo)
  git('init', '-q')
  git('config', 'user.email', 'alex@example.com')
  git('config', 'user.name', 'Alex')
  writeFileSync(join(repo, 'keep.txt'), 'one\n')
  writeFileSync(join(repo, 'edit.txt'), 'before\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'start')
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  const checkpoints = new Checkpoints((cwd) => gitOn({ exec: runProgram }, cwd), join(dir, 'tmp'))

  it('measures a turn and undoes only its files, leaving the index alone', async () => {
    writeFileSync(join(repo, 'mine.txt'), 'the user was here\n')
    const before = (await checkpoints.snapshot(repo))!
    expect(before).toMatch(/^[0-9a-f]{40}$/)
    // The "turn": an edit and a new file.
    writeFileSync(join(repo, 'edit.txt'), 'after\nmore\n')
    writeFileSync(join(repo, 'new.txt'), 'added\n')
    const after = (await checkpoints.snapshot(repo))!
    expect(await checkpoints.measure(repo, before, after)).toMatchObject({ files: 2, additions: 3, deletions: 1 })
    expect(git('status', '--porcelain')).not.toMatch(/^[AM] /m)

    expect(await checkpoints.revert(repo, before, after)).toBe(2)
    expect(readFileSync(join(repo, 'edit.txt'), 'utf8').replace(/\r\n/g, '\n')).toBe('before\n')
    expect(existsSync(join(repo, 'new.txt'))).toBe(false)
    // The user's own untracked file from before the turn is untouched.
    expect(readFileSync(join(repo, 'mine.txt'), 'utf8')).toBe('the user was here\n')
  })

  it('lists uncommitted changes, untracked files with their lines', async () => {
    const changes = new WorktreeChanges(gitOn({ exec: runProgram }, repo))
    writeFileSync(join(repo, 'edit.txt'), 'changed\n')
    const files = await changes.againstWorktree((await changes.head())!)
    expect(files).toEqual([
      { path: 'edit.txt', status: 'modified', additions: 1, deletions: 1 },
      { path: 'mine.txt', status: 'added', additions: 1, deletions: 0 }
    ])
    expect(await changes.fileAgainstWorktree('HEAD', 'mine.txt', true)).toContain('+the user was here')
  })

  it('counts untracked files as git does: a last line without its end, binary files (ADR 0064 amendment)', async () => {
    writeFileSync(join(dir, 'open-end.txt'), 'one\ntwo\nthree')
    writeFileSync(join(dir, 'empty.txt'), '')
    writeFileSync(join(dir, 'img.bin'), Buffer.from([137, 80, 78, 71, 0, 1, 2, 10, 10]))
    writeFileSync(join(dir, 'big.txt'), 'line\n'.repeat(100_000))
    expect(await countNewFile(join(dir, 'open-end.txt'))).toEqual({ additions: 3 })
    expect(await countNewFile(join(dir, 'empty.txt'))).toEqual({ additions: 0 })
    expect(await countNewFile(join(dir, 'img.bin'))).toEqual({ additions: 0, binary: true })
    expect(await countNewFile(join(dir, 'big.txt'))).toEqual({ additions: 100_000 })
    expect(await countNewFile(join(dir, 'missing.txt'))).toEqual({ additions: 0 })
  })

  it('lists at most MAX_LISTED_FILES files and counts the rest (ADR 0064 amendment)', () => {
    const files = Array.from({ length: MAX_LISTED_FILES + 5 }, (_, i) => ({ path: `f${i}`, status: 'added' as const, additions: 1, deletions: 0 }))
    const sent = listed(files)
    expect(sent.files).toHaveLength(MAX_LISTED_FILES)
    expect(sent.omitted).toBe(5)
    expect(sent.additions).toBe(MAX_LISTED_FILES + 5)
    expect(listed(files.slice(0, 3))).toEqual({ files: files.slice(0, 3), additions: 3, deletions: 0 })
  })

  it('is no checkpoint outside a repository', async () => {
    expect(await checkpoints.snapshot(dir)).toBeUndefined()
  })
})
