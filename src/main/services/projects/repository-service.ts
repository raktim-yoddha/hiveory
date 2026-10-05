import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AppException, fail } from '@shared/errors'
import { GitCommandError, type GitService } from '../git/git-service'

/** Cloning a big repository can take minutes. */
const CLONE_TIMEOUT_MS = 15 * 60_000

/** https, ssh:// or scp-style git@host:path; never an option or a transport helper (ext::, file:: …). */
export const isCloneUrl = (url: string): boolean =>
  !url.startsWith('-') && (/^https:\/\/[^\s]+$/i.test(url) || /^ssh:\/\/[^\s]+$/i.test(url) || /^[\w.-]+@[\w.-]+:[^\s]+$/.test(url))

/** "https://github.com/acme/web-app.git" → "web-app". */
export const repoNameOf = (url: string): string =>
  url.replace(/[/\\]+$/, '').replace(/\.git$/i, '').split(/[/:]/).filter(Boolean).at(-1) ?? 'repository'

/** A folder name that is safe on every platform. */
const FOLDER_NAME = /^[A-Za-z0-9._-]{1,100}$/

const run = (cmd: string, args: string[], cwd: string, timeout: number): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error) return resolve(stdout.toString())
      const missing = (error as NodeJS.ErrnoException).code === 'ENOENT'
      reject(missing ? new AppException({ code: 'GIT_FAILED', message: `${cmd === 'gh' ? 'The GitHub CLI (gh)' : 'Git'} is not installed.` }) : new GitCommandError(args, stderr.toString(), null))
    })
  })

const detail = (error: unknown): string => (error instanceof GitCommandError ? error.stderr.trim() || error.message : String(error))

/** The GitHub account `gh` is signed in to, and the owners it can create repositories under. */
export interface GithubAccount {
  available: boolean
  login?: string
  owners: string[]
  reason?: string
}

/**
 * New repositories and clones for Add project (ADR 0020). Git and the GitHub CLI
 * run without a shell; Hiveory stores no tokens (gh holds the user's login).
 */
export class RepositoryService {
  constructor(private readonly git: GitService) {}

  async githubAccount(): Promise<GithubAccount> {
    try {
      const login = (await run('gh', ['api', 'user', '--jq', '.login'], process.cwd(), 15_000)).trim()
      const orgs = (await run('gh', ['api', 'user/orgs', '--jq', '.[].login'], process.cwd(), 15_000).catch(() => ''))
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
      return { available: true, login, owners: [login, ...orgs] }
    } catch (error) {
      return { available: false, owners: [], reason: error instanceof AppException ? error.error.message : 'Run "gh auth login" to create repositories on GitHub.' }
    }
  }

  /** Clones `url` into a new folder under `parentDir`; returns that folder. */
  async clone(url: string, parentDir: string): Promise<string> {
    const operation = 'Clone repository'
    if (!isCloneUrl(url)) fail('INVALID_INPUT', 'Enter an https or SSH repository address.', { operation })
    const target = join(parentDir, repoNameOf(url))
    if (existsSync(target) && readdirSync(target).length) fail('INVALID_INPUT', `${target} already exists and isn't empty.`, { operation, hint: 'Pick another folder.' })
    mkdirSync(parentDir, { recursive: true })
    try {
      await run('git', ['clone', '--', url, target], parentDir, CLONE_TIMEOUT_MS)
    } catch (error) {
      if (error instanceof AppException) throw error
      fail('GIT_FAILED', 'Git could not clone that repository.', { operation, detail: detail(error), hint: 'Check the address and that you have access to it.' })
    }
    return target
  }

  /**
   * Makes a new repository folder under `parentDir` with a first commit, and,
   * when asked, creates it on GitHub under `owner` and pushes. Returns the folder,
   * and a warning when only the GitHub step failed (the local repository stays).
   */
  async create(name: string, parentDir: string, github?: { owner: string; visibility: 'private' | 'public' }): Promise<{ path: string; warning?: string }> {
    const operation = 'New repository'
    if (!FOLDER_NAME.test(name)) fail('INVALID_INPUT', 'Use letters, numbers, dots, dashes or underscores for the name.', { operation })
    const target = join(parentDir, name)
    if (existsSync(target)) fail('INVALID_INPUT', `${target} already exists.`, { operation, hint: 'Pick another name or folder.' })
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'README.md'), `# ${name}\n`)
    try {
      await this.git.init(target, true)
    } catch (error) {
      fail('GIT_FAILED', 'Git could not create the first commit.', {
        operation,
        detail: detail(error),
        hint: /user\.email|user\.name|who you are/i.test(detail(error)) ? 'Set your Git name and email (git config --global user.name / user.email), then try again.' : undefined
      })
    }
    if (github) {
      if (!/^[A-Za-z0-9-]{1,39}$/.test(github.owner)) fail('INVALID_INPUT', 'That GitHub owner name is not valid.', { operation })
      try {
        await run('gh', ['repo', 'create', `${github.owner}/${name}`, `--${github.visibility}`, '--source', target, '--remote', 'origin', '--push'], target, 120_000)
      } catch (error) {
        const why = error instanceof AppException ? error.error.message : detail(error)
        return { path: target, warning: `Created on this computer, but not on GitHub: ${why}` }
      }
    }
    return { path: target }
  }
}
