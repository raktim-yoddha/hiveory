import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { SshPrompt } from '@shared/domain/tailnet'
import { SshAuth } from './ssh-auth'

const log = { info: () => undefined, warn: () => undefined, error: () => undefined }
let auth: SshAuth | null = null

/** An SshAuth whose window answers with `reply` (or records the questions). */
const make = (reply: (p: SshPrompt) => string | null) => {
  const asked: SshPrompt[] = []
  const current = new SshAuth(mkdtempSync(join(tmpdir(), 'hv-auth-')), (event, payload) => {
    if (event !== 'ssh.prompt') return
    const prompt = payload as SshPrompt
    asked.push(prompt)
    queueMicrotask(() => current.answer(prompt.id, reply(prompt)))
  }, log)
  auth = current
  return { auth: current, asked }
}

afterEach(() => {
  auth?.close()
  auth = null
})

describe('SSH questions in the window', () => {
  it('classifies questions and asks a password once per session', async () => {
    const { auth, asked } = make(() => 'hunter2')
    expect(await auth.ask('box', "dev@box's password: ", '', 's1')).toBe('hunter2')
    expect(asked[0]).toMatchObject({ host: 'box', kind: 'secret' })
    // Another ssh process reuses it without asking again.
    expect(await auth.ask('box', "dev@box's password: ", '', 's2')).toBe('hunter2')
    expect(asked).toHaveLength(1)
    // Asked again by the same process: the remembered answer was refused, so ask the user.
    expect(await auth.ask('box', "dev@box's password: ", '', 's2')).toBe('hunter2')
    expect(asked).toHaveLength(2)
  })

  it('never reuses one-time codes, and forgets a host that refused the login', async () => {
    const { auth, asked } = make(() => '123456')
    await auth.ask('box', 'Verification code: ', '', 's1')
    await auth.ask('box', 'Verification code: ', '', 's2')
    expect(asked).toHaveLength(2)
    await auth.ask('box', 'Enter passphrase for key: ', '', 's3')
    auth.forget('box')
    await auth.ask('box', 'Enter passphrase for key: ', '', 's4')
    expect(asked).toHaveLength(4)
  })

  it('shows host-key questions as yes/no, and stops a process that keeps asking', async () => {
    const { auth, asked } = make(() => 'no')
    await auth.ask('box', 'Are you sure you want to continue connecting (yes/no/[fingerprint])? ', '', 's1')
    expect(asked[0]!.kind).toBe('confirm')
    for (let i = 0; i < 3; i++) await auth.ask('box', 'Please type yes: ', '', 's1')
    expect(await auth.ask('box', 'Please type yes: ', '', 's1')).toBeNull()
  })

  it('answers ssh through its askpass hook, multi-line prompts intact', async () => {
    const { auth, asked } = make((p) => (p.prompt.includes('fingerprint') ? 'yes' : null))
    const env = await auth.env('box')
    const dir = mkdtempSync(join(tmpdir(), 'hv-askpass-'))
    const prompt = "The authenticity of host 'box' can't be established.\nED25519 key fingerprint is SHA256:abc/def.\nAre you sure (yes/no/[fingerprint])? "
    const child = spawn(process.execPath, [prompt], { cwd: dir, env: { ...process.env, ...env } })
    let out = ''
    child.stdout.on('data', (d: Buffer) => (out += d))
    const code = await new Promise((r) => child.on('close', r))
    expect(code).toBe(0)
    expect(out).toBe('yes\n')
    expect(asked[0]).toMatchObject({ host: 'box', prompt, kind: 'confirm' })
  }, 20_000)

  it('refuses callers without the per-launch token', async () => {
    const { auth } = make(() => 'x')
    const env = await auth.env('box')
    const res = await fetch(env.HIVEORY_ASKPASS_URL!, { method: 'POST', body: '{}' })
    expect(res.status).toBe(403)
  })
})
