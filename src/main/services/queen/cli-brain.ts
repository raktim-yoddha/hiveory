import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PLAN_TOOL, strictSchema } from '@shared/queen/brain'
import { fail } from '@shared/errors'
import { sanitizeEnv } from '../pty/env'
import { killTree, resolveSpawnTarget } from '../pty/spawn-target'

/**
 * Subscription brains (ADR 0019 phase 5): the user's own Codex or Claude Code
 * CLI, signed in with their own plan, asked once for a plan. Hiveory never
 * reads their login: the official CLI does the request itself.
 *
 * Each run is locked down: an empty temporary folder as the working directory,
 * no tools (Claude Code) or no shell and a read-only sandbox (Codex), no user
 * config, MCP servers, hooks or saved session. The answer is still only a plan,
 * validated like any model's.
 */

export interface ProcessResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

export type RunProcess = (file: string, args: string[], input: string, options: { cwd: string; timeoutMs: number }) => Promise<ProcessResult>

const MAX_OUTPUT = 1024 * 1024

/** Spawns without a shell, feeds stdin, and kills the whole tree past the budget. */
export const runProcess: RunProcess = (file, args, input, { cwd, timeoutMs }) =>
  new Promise((resolve, reject) => {
    let target: ReturnType<typeof resolveSpawnTarget>
    try {
      target = resolveSpawnTarget(file, args)
    } catch (error) {
      return reject(error)
    }
    const child = spawn(target.file, target.args, { cwd, env: sanitizeEnv(process.env), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
    }, timeoutMs)
    child.stdout.on('data', (d: Buffer) => {
      if (stdout.length < MAX_OUTPUT) stdout += d.toString()
    })
    child.stderr.on('data', (d: Buffer) => {
      if (stderr.length < MAX_OUTPUT) stderr += d.toString()
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut })
    })
    child.stdin.on('error', () => undefined)
    child.stdin.end(input)
  })

/** The CLI's own error message, short enough to show. */
export const cliError = (text: string): string => {
  const quoted = [...text.matchAll(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/g)].at(-1)?.[1]
  if (quoted) return quoted.replace(/\\"/g, '"').slice(0, 300)
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  return (lines.findLast((l) => /error|login|log in|auth|not found|unsupported/i.test(l)) ?? lines.at(-1) ?? 'It exited without an answer.').slice(0, 300)
}

/** Codex rejects a reasoning effort its model doesn't support: worth one retry without it. */
export const isEffortRejection = (text: string): boolean => /reasoning|effort/i.test(text) && /unsupported|not supported|invalid/i.test(text)

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text.trim().replace(/^```(?:json)?|```$/g, '').trim())
  } catch {
    return {}
  }
}

export interface CliPlanInput {
  kind: 'codex' | 'claude-code'
  executable: string
  model: string
  system: string
  user: string
  /** Ask for low reasoning effort (Codex). */
  hint: boolean
  timeoutMs: number
}

/**
 * Runs one plan request and returns the `plan` arguments (unvalidated).
 * Throws AppException with the CLI's message on failure, or HintRejected-style
 * `{ effort: true }` errors the caller may retry without the hint.
 */
export async function planWithCli(input: CliPlanInput, run: RunProcess = runProcess): Promise<unknown> {
  const name = input.kind === 'codex' ? 'Codex CLI' : 'Claude Code CLI'
  // Saved models are checked on save; a hand-edited state file still never gets to pass a flag.
  if (input.model && !/^\w[\w.:/-]{0,99}$/.test(input.model)) fail('INVALID_INPUT', `${name}: that is not a model name.`)
  const dir = await mkdtemp(join(tmpdir(), 'hiveory-queen-'))
  try {
    if (input.kind === 'codex') {
      const schema = join(dir, 'plan.schema.json')
      const out = join(dir, 'answer.json')
      await writeFile(schema, JSON.stringify(strictSchema()))
      const args = [
        'exec',
        '--ephemeral',
        '--ignore-user-config',
        '--ignore-rules',
        '--skip-git-repo-check',
        '--sandbox',
        'read-only',
        '--disable',
        'shell_tool',
        '--disable',
        'apps',
        '--disable',
        'plugins',
        '--disable',
        'hooks',
        '-c',
        'web_search="disabled"',
        ...(input.hint ? ['-c', 'model_reasoning_effort="low"'] : []),
        ...(input.model ? ['--model', input.model] : []),
        '--cd',
        dir,
        '--output-schema',
        schema,
        '--color',
        'never',
        '--output-last-message',
        out,
        '-'
      ]
      const result = await run(input.executable, args, `${input.system}\n\n${input.user}`, { cwd: dir, timeoutMs: input.timeoutMs })
      if (result.timedOut) fail('INVALID_INPUT', `${name} took longer than ${input.timeoutMs / 1000} s.`)
      if (result.code !== 0) {
        const text = `${result.stderr}\n${result.stdout}`
        if (input.hint && isEffortRejection(text)) throw new EffortRejected()
        fail('INVALID_INPUT', `${name}: ${cliError(text)}`)
      }
      return parseJson(await readFile(out, 'utf8').catch(() => ''))
    }

    const args = [
      '-p',
      '--output-format',
      'json',
      '--json-schema',
      JSON.stringify(PLAN_TOOL.parameters),
      '--tools',
      '',
      '--strict-mcp-config',
      '--setting-sources',
      '',
      '--no-session-persistence',
      '--disable-slash-commands',
      '--system-prompt',
      input.system,
      '--model',
      input.model || 'haiku'
    ]
    const result = await run(input.executable, args, input.user, { cwd: dir, timeoutMs: input.timeoutMs })
    if (result.timedOut) fail('INVALID_INPUT', `${name} took longer than ${input.timeoutMs / 1000} s.`)
    const data = parseJson(result.stdout) as { is_error?: boolean; result?: unknown; structured_output?: unknown }
    if (data.is_error || (result.code !== 0 && !data.structured_output)) {
      const message = typeof data.result === 'string' && data.result ? data.result : cliError(`${result.stderr}\n${result.stdout}`)
      fail('INVALID_INPUT', `${name}: ${message.slice(0, 300)}`)
    }
    return data.structured_output ?? (typeof data.result === 'string' ? parseJson(data.result) : {})
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

export class EffortRejected extends Error {}
