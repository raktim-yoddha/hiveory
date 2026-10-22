import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PetLink, type PetAgent } from './pet-link'

const log = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as never

const get = (port: number, path: string, token?: string): Promise<{ status: number; body: string; close: () => void }> =>
  new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers: token ? { authorization: `Bearer ${token}` } : {} }, (res) => {
      let body = ''
      res.on('data', (chunk: Buffer) => {
        body += chunk.toString()
        if (body.includes('\n\n')) resolve({ status: res.statusCode ?? 0, body, close: () => req.destroy() })
      })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, close: () => undefined }))
    })
    req.on('error', reject)
    req.end()
  })

describe('PetLink (ADR 0054)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pet-link-'))
  const file = join(dir, 'Runtime', 'pet-link.json')
  let link: PetLink | null = null
  afterEach(() => link?.stop())

  it('writes its port and token for this user, streams agents to the token holder only, and cleans up', async () => {
    let agents: PetAgent[] = [{ id: 'a1', name: 'Maple', cli: 'Claude Code', cliId: 'claude', workspace: 'Shop', worktree: 'Primary', status: 'working' }]
    link = new PetLink(file, () => agents, log, '1.0.0')
    await link.start()
    const { port, token } = JSON.parse(readFileSync(file, 'utf8')) as { port: number; token: string }
    expect(token).toMatch(/^[0-9a-f]{48}$/)

    expect((await get(port, '/pet/events')).status).toBe(401)
    expect((await get(port, '/pet/events', 'f'.repeat(48))).status).toBe(401)
    expect((await get(port, '/elsewhere', token)).status).toBe(404)

    const stream = await get(port, '/pet/events', token)
    expect(stream.status).toBe(200)
    expect(JSON.parse(stream.body.replace(/^data: /, ''))).toEqual({ agents })
    stream.close()

    agents = []
    link.stop()
    expect(existsSync(file)).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })
})
