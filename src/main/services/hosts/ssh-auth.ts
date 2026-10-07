import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import type { SshPrompt } from '@shared/domain/tailnet'
import type { Logger } from '../../app/logger'

/** How long a question waits for the user before ssh is told "cancelled". */
const ANSWER_MS = 3 * 60_000
/** The same question more often than this in one ssh process means it is looping on bad answers. */
const MAX_REPEATS = 3

/**
 * Runs inside ssh's askpass call: the Hiveory executable in Node mode, loaded
 * through NODE_OPTIONS=--require so ssh can call the plain executable (no shell
 * or .cmd wrapper, which on Windows would cut prompts at their first line). It
 * does nothing in any other program that inherits the variables.
 */
const ASKPASS_JS = `'use strict'
if (process.env.HIVEORY_ASKPASS_EXEC && process.env.HIVEORY_ASKPASS_EXEC === process.execPath) {
  // Node resolved the prompt as a script path: undo the working-folder prefix (and Windows' backslashes).
  let prompt = process.argv[1] || ''
  const prefix = process.cwd() + require('path').sep
  if (prompt.startsWith(prefix)) prompt = prompt.slice(prefix.length)
  if (process.platform === 'win32') prompt = prompt.replace(/\\\\/g, '/')
  const body = JSON.stringify({ prompt, host: process.env.HIVEORY_ASKPASS_HOST || '', session: process.env.HIVEORY_ASKPASS_SESSION || '', kind: process.env.SSH_ASKPASS_PROMPT || '' })
  // Synchronously: the "script" ssh named is the prompt, not a file, so nothing may run after this preload.
  // A blocking child (same executable, without this preload) asks Hiveory and prints the answer.
  const ask = "const r=require('http').request(process.env.HIVEORY_ASKPASS_URL,{method:'POST',headers:{authorization:'Bearer '+process.env.HIVEORY_ASKPASS_TOKEN,'content-type':'application/json'}},(res)=>{let t='';res.setEncoding('utf8');res.on('data',(d)=>(t+=d));res.on('end',()=>{if(res.statusCode!==200)process.exit(1);process.stdout.write(JSON.parse(t).answer,()=>process.exit(0))})});r.on('error',()=>process.exit(1));r.end(process.env.HIVEORY_ASKPASS_BODY)"
  const result = require('child_process').spawnSync(process.execPath, ['-e', ask], {
    env: Object.assign({}, process.env, { NODE_OPTIONS: '', ELECTRON_RUN_AS_NODE: '1', HIVEORY_ASKPASS_BODY: body }),
    encoding: 'utf8',
    windowsHide: true
  })
  if (result.status !== 0) process.exit(1)
  require('fs').writeSync(1, result.stdout + '\\n')
  process.exit(0)
}
`

/** Passwords and key passphrases are reused for the session; one-time codes and yes/no never are. */
const reusable = (prompt: string): boolean => /passphrase|password/i.test(prompt) && !/code|otp|token|verif|one-time/i.test(prompt)

/**
 * SSH's questions, asked in Hiveory's window (ADR 0025, like Orca): passwords,
 * key passphrases and one-time codes reach the user through ssh's own askpass
 * hook. Answers live in memory for this session only and are never written to
 * disk; a host's are forgotten as soon as it refuses a login.
 */
export class SshAuth {
  private server: Server | null = null
  private url = ''
  private readonly token = randomBytes(24).toString('base64url')
  /** Question ids differ per process, so a client window can tell its own from its server's. */
  private readonly prefix = randomBytes(3).toString('hex')
  private readonly script: string
  private seq = 0
  private readonly waiting = new Map<string, { prompt: SshPrompt; resolve: (answer: string | null) => void; timer: NodeJS.Timeout }>()
  private readonly cache = new Map<string, string>()
  /** Questions per ssh process (session) and prompt. */
  private readonly asked = new Map<string, number>()

  constructor(
    runtimeDir: string,
    private readonly emit: (event: 'ssh.prompt' | 'ssh.promptDone', payload: unknown) => void,
    private readonly log: Logger
  ) {
    const dir = join(runtimeDir, 'ssh')
    mkdirSync(dir, { recursive: true })
    this.script = join(dir, 'askpass.cjs')
    writeFileSync(this.script, ASKPASS_JS, { mode: 0o600 })
  }

  /** Environment for one ssh process to `destination`: its questions come to this window. */
  async env(destination: string): Promise<Record<string, string>> {
    await this.listen()
    return {
      SSH_ASKPASS: process.execPath,
      SSH_ASKPASS_REQUIRE: 'force',
      // Older ssh only uses askpass with a display set.
      DISPLAY: process.env.DISPLAY || 'hiveory:0',
      ELECTRON_RUN_AS_NODE: '1',
      // Forward slashes: NODE_OPTIONS treats a backslash inside quotes as an escape.
      NODE_OPTIONS: `--require "${this.script.replace(/\\/g, '/')}"`,
      HIVEORY_ASKPASS_EXEC: process.execPath,
      HIVEORY_ASKPASS_URL: this.url,
      HIVEORY_ASKPASS_TOKEN: this.token,
      HIVEORY_ASKPASS_HOST: destination,
      HIVEORY_ASKPASS_SESSION: `s${++this.seq}`
    }
  }

  /** The window's answer (null = cancelled). Unknown ids (answered elsewhere, timed out) are ignored. */
  answer(id: string, answer: string | null): void {
    const entry = this.waiting.get(id)
    if (!entry) return
    this.waiting.delete(id)
    clearTimeout(entry.timer)
    this.emit('ssh.promptDone', { id })
    if (answer !== null && reusable(entry.prompt.prompt)) this.cache.set(`${entry.prompt.host}\n${entry.prompt.prompt}`, answer)
    entry.resolve(answer)
  }

  has(id: string): boolean {
    return this.waiting.has(id)
  }

  /** Questions still waiting (a window that opened after they were asked shows them). */
  pending(): SshPrompt[] {
    return [...this.waiting.values()].map((w) => w.prompt)
  }

  /** A host refused the login: its remembered answers were wrong. */
  forget(destination: string): void {
    for (const key of [...this.cache.keys()]) if (key.startsWith(`${destination}\n`)) this.cache.delete(key)
  }

  close(): void {
    for (const id of [...this.waiting.keys()]) this.answer(id, null)
    this.server?.close()
    this.server = null
  }

  /** One question from ssh: remembered, or asked in the window. */
  async ask(host: string, prompt: string, kind: string, session = ''): Promise<string | null> {
    const key = `${host}\n${prompt}`
    const turn = `${session}\n${key}`
    const times = this.asked.get(turn) ?? 0
    this.asked.set(turn, times + 1)
    if (this.asked.size > 500) this.asked.clear()
    if (times >= MAX_REPEATS) {
      this.forget(host)
      return null
    }
    // Asked again by the same process: the remembered answer was refused.
    const cached = times === 0 ? this.cache.get(key) : undefined
    if (times > 0) this.cache.delete(key)
    if (cached !== undefined) return cached
    const id = `q${this.prefix}${++this.seq}`
    const question: SshPrompt = {
      id,
      host,
      prompt,
      kind: kind === 'confirm' || /\(yes\/no/i.test(prompt) ? 'confirm' : kind === 'none' ? 'notice' : /password|passphrase|pin|secret|code|otp|token/i.test(prompt) ? 'secret' : 'text'
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.answer(id, null), ANSWER_MS)
      this.waiting.set(id, { prompt: question, resolve, timer })
      this.emit('ssh.prompt', question)
    })
  }

  private listen(): Promise<void> {
    if (this.server) return Promise.resolve()
    const server = createServer((req, res) => {
      if (req.method !== 'POST' || req.headers.authorization !== `Bearer ${this.token}`) return void res.writeHead(403).end()
      let body = ''
      req.setEncoding('utf8')
      req.on('data', (d: string) => (body = (body + d).slice(0, 16_000)))
      req.on('end', () => {
        let parsed: { prompt?: unknown; host?: unknown; kind?: unknown; session?: unknown }
        try {
          parsed = JSON.parse(body) as typeof parsed
        } catch {
          return void res.writeHead(400).end()
        }
        const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')
        void this.ask(text(parsed.host, 255), text(parsed.prompt, 4000), text(parsed.kind, 20), text(parsed.session, 40)).then((answer) => {
          if (answer === null) return void res.writeHead(410).end()
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ answer }))
        })
      })
    })
    this.server = server
    return new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        this.url = `http://127.0.0.1:${(server.address() as { port: number }).port}/ask`
        this.log.info('SSH questions are answered in the window')
        resolve()
      })
    })
  }
}
