import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@shared/domain/chat'
import { ChatAccumulator } from './accumulator'
import { claudeParser, codexParser, geminiParser, opencodeParser, plainParser, type LineParser } from './parsers'
import { CHAT_PROVIDERS, parseCodexModels, parseOpencodeModels, promptArg, transcriptPrompt } from './providers'

const fold = (parser: LineParser, lines: string[]) => {
  const message: ChatMessage = { id: 'a', role: 'assistant', parts: [], createdAt: '' }
  const acc = new ChatAccumulator(message)
  for (const line of lines) for (const e of parser(line)) acc.apply(e)
  return { acc, message }
}

describe('claude stream-json', () => {
  it('streams deltas then settles on the final text without duplicating', () => {
    const { acc, message } = fold(claudeParser(), [
      '{"type":"system","subtype":"init","session_id":"s-1"}',
      '{"type":"stream_event","event":{"type":"message_start","message":{"id":"msg1"}}}',
      '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hel"}}}',
      '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"lo"}}}',
      '{"type":"assistant","message":{"id":"msg1","content":[{"type":"text","text":"Hello!"}]}}',
      '[claude-code:unrecognized_model] {"model":"x"}',
      '{"type":"result","subtype":"success","is_error":false,"result":"Hello!","session_id":"s-1"}'
    ])
    expect(message.parts).toEqual([{ kind: 'text', text: 'Hello!' }])
    expect(acc.sessionId).toBe('s-1')
    expect(acc.done).toBe(true)
    expect(acc.errors).toEqual([])
  })

  it('tracks tool calls through to their results', () => {
    const { message } = fold(claudeParser(), [
      '{"type":"assistant","message":{"id":"m","content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"ls -la"}}]}}',
      '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"a.txt","is_error":false}]}}'
    ])
    expect(message.parts).toEqual([{ kind: 'tool', id: 't1', name: 'Bash', detail: 'ls -la', output: 'a.txt', status: 'done' }])
  })

  it('surfaces errors from the result line (real captured auth failure)', () => {
    const { acc } = fold(claudeParser(), [
      '{"type":"assistant","message":{"content":[{"type":"text","text":"Failed to authenticate: OAuth session expired"}]}}',
      '{"type":"result","subtype":"success","is_error":true,"result":"Failed to authenticate: OAuth session expired","session_id":"x"}'
    ])
    expect(acc.errors).toEqual(['Failed to authenticate: OAuth session expired'])
  })

  it('reads Grok/Anthropic wire events and plain error lines', () => {
    const { message, acc } = fold(claudeParser(), [
      '{"type":"message_start","message":{"id":"g1"}}',
      '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"pong"}}',
      'error: failed to run prompt: provider.rate_limit: 429'
    ])
    expect(message.parts).toEqual([{ kind: 'text', text: 'pong' }])
    expect(acc.errors[0]).toMatch(/rate_limit/)
  })
})

describe('codex exec --json (captured)', () => {
  it('collects thread id, messages, commands and completion', () => {
    const { acc, message } = fold(codexParser(), [
      '{"type":"thread.started","thread_id":"01a1067b-a99a-7dd3-b71b-4da012cb81f8"}',
      '{"type":"turn.started"}',
      '{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"git status","status":"in_progress"}}',
      '{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"git status","aggregated_output":"clean","exit_code":0,"status":"completed"}}',
      '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"pong"}}',
      '{"type":"turn.completed","usage":{"input_tokens":1}}'
    ])
    expect(acc.sessionId).toBe('01a1067b-a99a-7dd3-b71b-4da012cb81f8')
    expect(message.parts).toEqual([
      { kind: 'tool', id: 'item_1', name: 'Shell', detail: 'git status', output: 'clean', status: 'done' },
      { kind: 'text', text: 'pong' }
    ])
    expect(acc.done).toBe(true)
  })

  it('reports failed turns', () => {
    const { acc } = fold(codexParser(), ['{"type":"turn.failed","error":{"message":"quota exceeded"}}'])
    expect(acc.errors).toEqual(['quota exceeded'])
  })
})

describe('opencode run --format json (captured)', () => {
  it('reads text parts and the session id', () => {
    const { acc, message } = fold(opencodeParser(), [
      '{"type":"step_start","sessionID":"ses_1","part":{"id":"p0","type":"step-start"}}',
      '{"type":"text","sessionID":"ses_1","part":{"id":"p1","type":"text","text":"pong"}}',
      '{"type":"step_finish","sessionID":"ses_1","part":{"id":"p2","type":"step-finish"}}'
    ])
    expect(acc.sessionId).toBe('ses_1')
    expect(message.parts).toEqual([{ kind: 'text', text: 'pong' }])
  })

  it('reads provider errors (captured)', () => {
    const { acc } = fold(opencodeParser(), [
      '{"type":"error","sessionID":"ses_2","error":{"name":"ProviderAuthError","data":{"providerID":"x","message":"Anthropic API key is missing."}}}'
    ])
    expect(acc.errors).toEqual(['Anthropic API key is missing.'])
  })

  it('tracks tool use state', () => {
    const { message } = fold(opencodeParser(), [
      '{"type":"tool_use","sessionID":"s","part":{"id":"p","callID":"c1","tool":"bash","state":{"status":"running","input":{"command":"ls"}}}}',
      '{"type":"tool_use","sessionID":"s","part":{"id":"p","callID":"c1","tool":"bash","state":{"status":"completed","input":{"command":"ls"},"output":"x"}}}'
    ])
    expect(message.parts).toEqual([{ kind: 'tool', id: 'c1', name: 'bash', detail: 'ls', output: 'x', status: 'done' }])
  })
})

describe('gemini and plain parsers', () => {
  it('streams gemini deltas', () => {
    const { acc, message } = fold(geminiParser(), [
      '{"type":"init","session_id":"g"}',
      '{"type":"message","role":"assistant","content":"po","delta":true}',
      '{"type":"message","role":"assistant","content":"ng","delta":true}',
      '{"type":"result","status":"success"}'
    ])
    expect(message.parts).toEqual([{ kind: 'text', text: 'pong' }])
    expect(acc.sessionId).toBe('g')
  })

  it('treats plain output as text', () => {
    const { message } = fold(plainParser(), ['line one', 'line two'])
    expect(message.parts).toEqual([{ kind: 'text', text: 'line one\nline two\n' }])
  })
})

describe('model discovery', () => {
  it('parses opencode verbose listings with variants', () => {
    const text = [
      'opencode-go/deepseek-v4-flash',
      '{',
      '  "id": "deepseek-v4-flash",',
      '  "providerID": "opencode-go",',
      '  "name": "DeepSeek V4 Flash",',
      '  "variants": { "low": { "reasoningEffort": "low" }, "high": { "reasoningEffort": "high" } }',
      '}',
      'opencode/big-pickle',
      '{ "name": "Big Pickle" }'
    ].join('\n')
    expect(parseOpencodeModels(text)).toEqual([
      { id: 'opencode-go/deepseek-v4-flash', label: 'DeepSeek V4 Flash', group: 'opencode-go', efforts: ['low', 'high'] },
      { id: 'opencode/big-pickle', label: 'Big Pickle', group: 'opencode', efforts: [] }
    ])
  })

  it('parses codex debug models with per-model efforts and hides hidden ones', () => {
    const json = JSON.stringify({
      models: [
        { slug: 'gpt-6-astra', display_name: 'GPT-6-Astra', default_reasoning_level: 'low', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'max' }], visibility: 'list' },
        { slug: 'internal', visibility: 'hide' }
      ]
    })
    expect(parseCodexModels(json)).toEqual([{ id: 'gpt-6-astra', label: 'GPT-6-Astra', description: undefined, efforts: ['low', 'max'], defaultEffort: 'low' }])
  })
})

describe('provider command lines', () => {
  it('claude: new session gets an id, later turns resume; prompt on stdin', () => {
    const first = CHAT_PROVIDERS.claude!.run({ prompt: 'hi', autoApprove: false, model: 'opus', effort: 'high' })
    expect(first.args).toEqual(expect.arrayContaining(['-p', '--model', 'opus', '--effort', 'high', '--session-id']))
    expect(first.stdin).toBe('hi')
    expect(first.assignedSessionId).toBeTruthy()
    const next = CHAT_PROVIDERS.claude!.run({ prompt: 'again', autoApprove: true, sessionId: 's1' })
    expect(next.args).toEqual(expect.arrayContaining(['--resume', 's1', '--dangerously-skip-permissions']))
  })

  it('codex resumes threads and maps effort to model_reasoning_effort', () => {
    const run = CHAT_PROVIDERS.codex!.run({ prompt: 'x', autoApprove: false, effort: 'xhigh', sessionId: 't1' })
    expect(run.args).toEqual(['exec', '--json', '--skip-git-repo-check', '-c', 'model_reasoning_effort="xhigh"', 'resume', 't1', '-'])
  })

  it('opencode passes model, variant and session; prompts never look like flags', () => {
    const run = CHAT_PROVIDERS.opencode!.run({ prompt: '--help me', autoApprove: true, model: 'a/b', effort: 'max', sessionId: 'ses' })
    expect(run.args).toEqual(['run', '--format', 'json', '-m', 'a/b', '--variant', 'max', '-s', 'ses', '--auto', ' --help me'])
    expect(promptArg('normal')).toBe('normal')
  })

  it('antigravity is never a chat provider', () => {
    expect(CHAT_PROVIDERS.antigravity).toBeUndefined()
  })

  it('replays a bounded transcript for CLIs that cannot resume', () => {
    expect(transcriptPrompt([], 'hi')).toBe('hi')
    const prompt = transcriptPrompt(
      [
        { role: 'user', text: 'one' },
        { role: 'assistant', text: 'two' }
      ],
      'three'
    )
    expect(prompt).toBe('Conversation so far:\nUser: one\n\nAssistant: two\n\nUser: three')
    const long = transcriptPrompt([{ role: 'user', text: 'x'.repeat(50) }, { role: 'assistant', text: 'recent' }], 'q', 20)
    expect(long).toContain('recent')
    expect(long).not.toContain('xxxx')
  })
})
