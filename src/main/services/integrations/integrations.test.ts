import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { codeHostOf, jiraSiteOf } from '@shared/domain/integrations'
import type { Project } from '@shared/domain'
import { AppException } from '@shared/errors'
import { SecretBox, type Sealer } from '../connections/secret-box'
import { GithubService } from '../git/github-service'
import { GitlabService } from '../git/gitlab-service'
import type { GitService } from '../git/git-service'
import type { CodeHost } from '../git/code-host'
import { StateStore } from '../persistence/state-store'
import { IntegrationService } from './integration-service'
import { TrackerService } from './tracker-service'

const sealer: Sealer = {
  isEncryptionAvailable: () => true,
  encryptString: (v) => Buffer.from([...Buffer.from(v)].map((b) => b ^ 0x5a)),
  decryptString: (b) => Buffer.from([...b].map((x) => x ^ 0x5a)).toString()
}
const log = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as never
const newStore = (): StateStore => new StateStore(join(mkdtempSync(join(tmpdir(), 'hv-int-')), 'state.json'), log)
const project = (settings?: Project['settings']): Project => ({ id: 'p', name: 'web', path: '/home/me/web', createdAt: '', updatedAt: '', lastOpenedAt: '', settings }) as Project

describe('code host detection', () => {
  it('reads the host from the origin address', () => {
    expect(codeHostOf('git@gitlab.com:acme/web.git')).toBe('gitlab')
    expect(codeHostOf('https://gitlab.acme.dev/team/web')).toBe('gitlab')
    expect(codeHostOf('https://github.com/acme/web.git')).toBe('github')
    expect(codeHostOf('git@git.acme.dev:web.git')).toBe('github')
    expect(codeHostOf(undefined)).toBeUndefined()
  })

  it('follows the Workspace setting over the remote, and none turns it off', async () => {
    const hosts = { github: { id: 'github' }, gitlab: { id: 'gitlab' } } as unknown as Record<'github' | 'gitlab', CodeHost>
    const git = { remoteUrl: async () => 'git@gitlab.com:acme/web.git' } as unknown as GitService
    const service = new IntegrationService(git, hosts, {} as TrackerService)
    expect((await service.hostFor(project(), '/r'))?.id).toBe('gitlab')
    expect((await service.hostFor(project({ codeHost: 'github' }), '/r'))?.id).toBe('github')
    expect(await service.hostFor(project({ codeHost: 'none' }), '/r')).toBeNull()
  })
})

describe('GitHub and GitLab through their CLIs', () => {
  it('maps gh output, including the default branch', async () => {
    const gh = async (_cwd: string, args: string[]): Promise<string> =>
      args[0] === 'repo'
        ? JSON.stringify({ nameWithOwner: 'acme/web', url: 'https://github.com/acme/web', defaultBranchRef: { name: 'main' } })
        : JSON.stringify([{ number: 7, title: 'Crash on save', url: 'https://github.com/acme/web/issues/7' }])
    const service = new GithubService({} as GitService, gh)
    expect(await service.status('/r')).toEqual({ available: true, host: 'github', repository: 'acme/web', url: 'https://github.com/acme/web', defaultBranch: 'main' })
    expect(await service.issues('/r')).toEqual([{ key: '#7', title: 'Crash on save', url: 'https://github.com/acme/web/issues/7' }])
  })

  it('maps glab merge requests and issues, and opens one after pushing', async () => {
    const calls: string[][] = []
    const glab = async (_cwd: string, args: string[]): Promise<string> => {
      calls.push(args)
      if (args[0] === 'mr' && args[1] === 'list')
        return JSON.stringify([{ iid: 3, title: 'Add login', source_branch: 'hiveory/login', web_url: 'https://gitlab.com/acme/web/-/merge_requests/3', draft: true, updated_at: 'x', author: { username: 'alex' } }])
      if (args[0] === 'issue') return JSON.stringify([{ iid: 9, title: 'Slow search', web_url: 'https://gitlab.com/acme/web/-/issues/9', state: 'opened' }])
      if (args[0] === 'mr' && args[1] === 'create') return 'Creating merge request\nhttps://gitlab.com/acme/web/-/merge_requests/4\n'
      return '{}'
    }
    const pushed: string[][] = []
    const service = new GitlabService({ run: async (_cwd: string, args: string[]) => (pushed.push(args), '') } as unknown as GitService, glab)
    expect(await service.pullRequests('/r')).toEqual([
      { number: 3, title: 'Add login', branch: 'hiveory/login', url: 'https://gitlab.com/acme/web/-/merge_requests/3', draft: true, updatedAt: 'x', author: 'alex' }
    ])
    expect(await service.issues('/r')).toEqual([{ key: '#9', title: 'Slow search', url: 'https://gitlab.com/acme/web/-/issues/9', state: 'opened' }])
    expect(await service.createPullRequest('/r', '/r/wt', 'hiveory/x', false)).toBe('https://gitlab.com/acme/web/-/merge_requests/4')
    expect(pushed).toEqual([['push', '-u', 'origin', 'hiveory/x']])
    expect(calls.at(-1)).toEqual(['mr', 'create', '--source-branch', 'hiveory/x', '--fill', '--yes'])
  })

  it('reports a missing CLI as unavailable instead of failing', async () => {
    const missing = async (): Promise<string> => {
      throw new AppException({ code: 'GIT_FAILED', message: 'The GitLab CLI (glab) is not installed.', hint: 'Install glab and run "glab auth login".' })
    }
    const service = new GitlabService({} as GitService, missing)
    expect(await service.status('/r')).toEqual({ available: false, host: 'gitlab', reason: 'Install glab and run "glab auth login".' })
    expect((await service.account()).available).toBe(false)
  })
})

describe('Jira and Linear', () => {
  it('accepts only https Jira sites', () => {
    expect(jiraSiteOf('acme.atlassian.net')).toBe('https://acme.atlassian.net')
    expect(jiraSiteOf('https://Acme.atlassian.net/jira/software/projects')).toBe('https://acme.atlassian.net')
    expect(jiraSiteOf('http://acme.atlassian.net')).toBeUndefined()
    expect(jiraSiteOf('https://me:pw@acme.atlassian.net')).toBeUndefined()
    expect(jiraSiteOf('not a site')).toBeUndefined()
  })

  it('checks a Jira key before saving it sealed, lists open issues, and never shows the key', async () => {
    const requests: Array<{ url: string; auth: string | undefined }> = []
    const http = (async (url: string, init: RequestInit) => {
      requests.push({ url, auth: (init.headers as Record<string, string>).Authorization })
      const body = url.includes('/myself') ? { accountId: 'a' } : { issues: [{ key: 'WEB-4', fields: { summary: 'Fix sign-in', status: { name: 'In Progress' } } }] }
      return new Response(JSON.stringify(body), { status: 200 })
    }) as typeof fetch
    const store = newStore()
    const trackers = new TrackerService(store, new SecretBox(sealer), http)
    await trackers.connectJira({ site: 'acme.atlassian.net', email: 'alex@example.com', token: 'tok-123' })
    expect(store.state.trackers?.jira?.token).not.toContain('tok-123')
    expect(trackers.view()).toEqual({ jira: { site: 'https://acme.atlassian.net', email: 'alex@example.com' } })
    expect(await trackers.issues('jira', 'WEB')).toEqual([{ key: 'WEB-4', title: 'Fix sign-in', url: 'https://acme.atlassian.net/browse/WEB-4', state: 'In Progress' }])
    expect(requests.every((r) => r.url.startsWith('https://acme.atlassian.net/') && r.auth === `Basic ${Buffer.from('alex@example.com:tok-123').toString('base64')}`)).toBe(true)
    expect(requests[1]!.url).toContain(encodeURIComponent('project = "WEB"'))
    await expect(trackers.issues('jira', 'WEB" OR 1=1')).rejects.toThrow('not a Jira project key')
    trackers.disconnect('jira')
    expect(trackers.view()).toEqual({})
  })

  it('does not save a Linear key the service refuses', async () => {
    const http = (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch
    const store = newStore()
    const trackers = new TrackerService(store, new SecretBox(sealer), http)
    await expect(trackers.connectLinear('lin_bad')).rejects.toThrow('did not accept')
    expect(store.state.trackers?.linear).toBeUndefined()
  })

  it('says why a Workspace shows no issues', async () => {
    const service = new IntegrationService({} as GitService, {} as never, new TrackerService(newStore(), new SecretBox(sealer)))
    expect((await service.issues(project({ issueSource: 'none' }), '/r')).reason).toMatch(/turned off/)
    expect((await service.issues(project({ issueSource: 'linear' }), '/r')).reason).toMatch(/Pick a Linear team/)
    expect((await service.issues(project({ issueSource: 'linear', trackerGroup: 'ENG' }), '/r')).reason).toMatch(/Linear is not connected/)
  })
})
