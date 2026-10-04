import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { AppException } from '@shared/errors'
import { gitArgs, stripRemote } from './git-commands'

export class GitCommandError extends Error {
  constructor(
    readonly args: string[],
    readonly stderr: string,
    readonly exitCode: number | null
  ) {
    super(`git ${args.join(' ')} failed: ${stderr.trim() || `exit ${exitCode}`}`)
  }
}

/** Thin, typed wrapper over the git executable. No shell is involved. */
export class GitService {
  constructor(private readonly timeoutMs = 30_000) {}

  run(cwd: string, args: string[]): Promise<string> {
    return new Promise((done, reject) => {
      execFile(
        'git',
        args,
        { cwd, timeout: this.timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (!error) return done(stdout.toString())
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return reject(
              new AppException({
                code: 'GIT_FAILED',
                message: 'Git is not installed or not on PATH.',
                hint: 'Install Git and restart Hiveory.'
              })
            )
          }
          const code = typeof error.code === 'number' ? error.code : null
          reject(new GitCommandError(args, stderr.toString(), code))
        }
      )
    })
  }

  private async tryRun(cwd: string, args: string[]): Promise<string | undefined> {
    try {
      return (await this.run(cwd, args)).trim()
    } catch (error) {
      if (error instanceof AppException) throw error
      return undefined
    }
  }

  /** Repository root for `path`, or undefined when it is not inside a repository. */
  async repositoryRoot(path: string): Promise<string | undefined> {
    const root = await this.tryRun(path, gitArgs.topLevel())
    return root ? resolve(root) : undefined
  }

  async currentBranch(path: string): Promise<string | undefined> {
    return (await this.tryRun(path, gitArgs.currentBranch())) || undefined
  }

  async hasCommits(repoRoot: string): Promise<boolean> {
    return (await this.tryRun(repoRoot, gitArgs.hasCommits())) !== undefined
  }

  async localBranchExists(repoRoot: string, branch: string): Promise<boolean> {
    return (await this.tryRun(repoRoot, gitArgs.localBranchExists(branch))) !== undefined
  }

  /** origin's default branch, else local main/master, else the current branch. */
  async defaultBranch(repoRoot: string): Promise<string | undefined> {
    const remote = await this.tryRun(repoRoot, gitArgs.remoteHead())
    if (remote) {
      const name = stripRemote(remote)
      return (await this.localBranchExists(repoRoot, name)) ? name : remote
    }
    for (const candidate of ['main', 'master']) {
      if (await this.localBranchExists(repoRoot, candidate)) return candidate
    }
    return this.currentBranch(repoRoot)
  }
}
