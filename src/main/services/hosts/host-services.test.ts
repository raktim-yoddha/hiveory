import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AppException } from '@shared/errors'
import { transportPair } from '@shared/host/protocol'
import { serveHost } from '../../../host/host-server'
import type { HostKit } from './host-kit'
import { HostClient } from './host-client'

const connect = () => {
  const [clientSide, hostSide] = transportPair()
  serveHost(hostSide, { trash: async () => undefined })
  return new HostClient(clientSide)
}

const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), 'hv-host-repo-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' })
  git('init', '-b', 'main')
  git('config', 'user.email', 'e2e@example.test')
  git('config', 'user.name', 'e2e')
  writeFileSync(join(dir, 'README.md'), '# demo\n')
  git('add', '.')
  git('commit', '-m', 'init')
  return dir
}

describe('host services (git, files, fs run on the host)', () => {
  it('answers git through a proxy with the same signatures as the local service', async () => {
    const client = connect()
    const git = client.service<HostKit['git']>('git')
    const dir = repo()
    expect(await git.hasCommits(dir)).toBe(true)
    expect(await git.localBranches(dir)).toEqual(['main'])
    expect(await git.branchNameProblem(dir, 'bad name')).toBeTruthy()
  })

  it('keeps typed errors across the wire', async () => {
    const client = connect()
    const files = client.service<HostKit['files']>('files')
    const dir = repo()
    const escape = await files.read(dir, '../outside.txt').catch((e: unknown) => e)
    expect(escape).toBeInstanceOf(AppException)
    expect((escape as AppException).error.code).toBe('FORBIDDEN')
    const worktrees = client.service<HostKit['worktrees']>('worktrees')
    const clash = await worktrees.create({ repoRoot: dir, path: join(dir, '..', `wt-${Date.now()}`), branch: 'main' }).catch((e: unknown) => e)
    expect(clash).toBeInstanceOf(AppException)
    expect((clash as AppException).error.message).toContain('already checked out')
  })

  it('only runs allowed service methods', async () => {
    const client = connect()
    await expect(client.call('invoke', { service: 'git', method: 'run', args: ['.', ['status']] })).rejects.toThrow('Not allowed')
    await expect(client.call('invoke', { service: 'files', method: 'constructor', args: [] })).rejects.toThrow('Not allowed')
  })

  it('finds programs on the host PATH', async () => {
    const client = connect()
    const found = await client.call('which', { names: ['node', 'definitely-not-a-program-hv'] })
    expect(found.node).toBeTruthy()
    expect(found['definitely-not-a-program-hv']).toBeUndefined()
  })

  it('reports file changes in a watched folder as events', async () => {
    const client = connect()
    const dir = repo()
    const changed = new Promise<string[]>((resolve) => client.onFilesChanged((e) => resolve(e.paths)))
    await client.service<HostKit['files']>('files').watch('scope-1', dir, true)
    await new Promise((r) => setTimeout(r, 100))
    writeFileSync(join(dir, 'new.txt'), 'x')
    expect((await changed).some((p) => p.includes('new.txt'))).toBe(true)
    await client.service<HostKit['files']>('files').watch('scope-1', dir, false)
  }, 15_000)
})
