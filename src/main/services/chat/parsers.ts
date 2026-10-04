/**
 * Line parsers for each CLI's headless output, normalized into one small
 * event vocabulary. Pure: each takes raw stdout lines, so they are unit-tested
 * against captured real output.
 */

export type ChatEvent =
  | { type: 'session'; id: string }
  /** `delta` appends to the part with `key`; `full` replaces it (final text after streaming). */
  | { type: 'text'; key: string; delta?: string; full?: string }
  | { type: 'thinking'; key: string; delta?: string; full?: string }
  | { type: 'tool'; id: string; name?: string; detail?: string; output?: string; status: 'running' | 'done' | 'error' }
  | { type: 'error'; message: string }
  | { type: 'done' }

export type LineParser = (line: string) => ChatEvent[]

const MAX_OUTPUT = 4000

const parseJson = (line: string): Record<string, unknown> | null => {
  const trimmed = line.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const value = JSON.parse(trimmed)
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const rec = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {})
const s = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const clip = (text: string): string => (text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}…` : text)

/** Short human summary of a tool's input (command, path, pattern…). */
export const summarizeInput = (input: unknown): string | undefined => {
  const i = rec(input)
  for (const key of ['command', 'cmd', 'file_path', 'path', 'filePath', 'pattern', 'query', 'url', 'description', 'prompt']) {
    const v = i[key]
    if (typeof v === 'string' && v) return v.length > 160 ? `${v.slice(0, 160)}…` : v
    if (Array.isArray(v) && v.length) return v.join(' ').slice(0, 160)
  }
  return undefined
}

const toolResultText = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((c) => s(rec(c).text) ?? '').join('\n')
  return ''
}

/** Non-JSON lines that clearly report a failure (e.g. "error: …" from Kimi). */
const plainError = (line: string): ChatEvent[] => (/^\s*(error|fatal)\b[:\s]/i.test(line) ? [{ type: 'error', message: line.trim() }] : [])

/**
 * Claude Code `--output-format stream-json` (also Grok's Anthropic-format
 * stream, Cursor and Kimi which mirror it). Partial deltas stream text; the
 * full assistant message then replaces the streamed text for that block.
 */
export const claudeParser = (): LineParser => {
  let messageId = 'm0'
  return (line) => {
    const j = parseJson(line)
    if (!j) return plainError(line)
    const out: ChatEvent[] = []
    const sessionId = s(j.session_id)
    const handleStreamEvent = (event: Record<string, unknown>): void => {
      const type = s(event.type)
      if (type === 'message_start') messageId = s(rec(event.message).id) ?? messageId
      if (type === 'content_block_start') {
        const block = rec(event.content_block)
        if (block.type === 'tool_use') {
          out.push({ type: 'tool', id: s(block.id) ?? `${messageId}:${String(event.index)}`, name: s(block.name), status: 'running' })
        }
      }
      if (type === 'content_block_delta') {
        const delta = rec(event.delta)
        const key = `${messageId}:${String(event.index ?? 0)}`
        if (delta.type === 'text_delta' && s(delta.text)) out.push({ type: 'text', key, delta: s(delta.text) })
        if (delta.type === 'thinking_delta' && s(delta.thinking)) out.push({ type: 'thinking', key, delta: s(delta.thinking) })
      }
    }
    switch (j.type) {
      case 'system':
        if (j.subtype === 'init' && sessionId) out.push({ type: 'session', id: sessionId })
        break
      case 'stream_event':
        handleStreamEvent(rec(j.event))
        break
      case 'message_start':
      case 'content_block_start':
      case 'content_block_delta':
        handleStreamEvent(j)
        break
      case 'assistant': {
        const message = rec(j.message)
        const id = s(message.id) ?? messageId
        const content = Array.isArray(message.content) ? message.content : []
        content.forEach((raw, index) => {
          const block = rec(raw)
          const key = `${id}:${index}`
          if (block.type === 'text' && typeof block.text === 'string') out.push({ type: 'text', key, full: block.text })
          if (block.type === 'thinking' && typeof block.thinking === 'string') out.push({ type: 'thinking', key, full: block.thinking })
          if (block.type === 'tool_use') {
            out.push({ type: 'tool', id: s(block.id) ?? key, name: s(block.name), detail: summarizeInput(block.input), status: 'running' })
          }
        })
        break
      }
      case 'user': {
        const content = Array.isArray(rec(j.message).content) ? (rec(j.message).content as unknown[]) : []
        for (const raw of content) {
          const block = rec(raw)
          if (block.type !== 'tool_result') continue
          out.push({
            type: 'tool',
            id: s(block.tool_use_id) ?? 'tool',
            output: clip(toolResultText(block.content)),
            status: block.is_error ? 'error' : 'done'
          })
        }
        break
      }
      case 'tool_call': {
        // Cursor: { subtype: started|completed, call_id, tool_call: { <name>ToolCall: { args, result } } }
        const [name, body] = Object.entries(rec(j.tool_call))[0] ?? ['tool', {}]
        const id = s(j.call_id) ?? name
        const label = name.replace(/ToolCall$/, '')
        if (j.subtype === 'started') out.push({ type: 'tool', id, name: label, detail: summarizeInput(rec(body).args), status: 'running' })
        else out.push({ type: 'tool', id, name: label, status: 'done' })
        break
      }
      case 'result':
        if (sessionId) out.push({ type: 'session', id: sessionId })
        if (j.is_error) out.push({ type: 'error', message: s(j.result) ?? s(j.error) ?? `Run ended: ${s(j.subtype) ?? 'error'}` })
        out.push({ type: 'done' })
        break
    }
    return out
  }
}

/** Codex `exec --json`: thread/turn/item events. */
export const codexParser = (): LineParser => (line) => {
  const j = parseJson(line)
  if (!j) return plainError(line)
  const type = s(j.type)
  if (type === 'thread.started' && s(j.thread_id)) return [{ type: 'session', id: s(j.thread_id) as string }]
  if (type === 'turn.completed') return [{ type: 'done' }]
  if (type === 'turn.failed') return [{ type: 'error', message: s(rec(j.error).message) ?? 'Turn failed' }, { type: 'done' }]
  if (type === 'error') return [{ type: 'error', message: s(j.message) ?? 'Codex error' }]
  if (!type?.startsWith('item.')) return []
  const item = rec(j.item)
  const id = s(item.id) ?? 'item'
  const finished = type === 'item.completed'
  switch (item.type) {
    case 'agent_message':
      return s(item.text) ? [{ type: 'text', key: id, full: s(item.text) }] : []
    case 'reasoning':
      return s(item.text) ? [{ type: 'thinking', key: id, full: s(item.text) }] : []
    case 'command_execution':
      return [
        {
          type: 'tool',
          id,
          name: 'Shell',
          detail: s(item.command),
          output: s(item.aggregated_output) ? clip(s(item.aggregated_output) as string) : undefined,
          status: !finished ? 'running' : item.status === 'failed' || (typeof item.exit_code === 'number' && item.exit_code !== 0) ? 'error' : 'done'
        }
      ]
    case 'file_change': {
      const changes = Array.isArray(item.changes) ? item.changes.map((c) => s(rec(c).path)).filter(Boolean) : []
      return [{ type: 'tool', id, name: 'Edit files', detail: changes.join(', '), status: finished ? 'done' : 'running' }]
    }
    case 'mcp_tool_call':
      return [{ type: 'tool', id, name: `${s(item.server) ?? 'mcp'}.${s(item.tool) ?? 'tool'}`, status: finished ? (item.status === 'failed' ? 'error' : 'done') : 'running' }]
    case 'web_search':
      return [{ type: 'tool', id, name: 'Web search', detail: s(item.query), status: finished ? 'done' : 'running' }]
    case 'error':
      return [{ type: 'error', message: s(item.message) ?? 'Codex error' }]
    default:
      return []
  }
}

/** OpenCode / Kilo `run --format json`: step/text/reasoning/tool_use events keyed by part id. */
export const opencodeParser = (): LineParser => {
  let announced = false
  return (line) => {
    const j = parseJson(line)
    if (!j) return plainError(line)
    const out: ChatEvent[] = []
    const sessionId = s(j.sessionID)
    if (sessionId && !announced) {
      announced = true
      out.push({ type: 'session', id: sessionId })
    }
    const part = rec(j.part)
    const key = s(part.id) ?? 'part'
    switch (j.type) {
      case 'text':
        if (typeof part.text === 'string') out.push({ type: 'text', key, full: part.text })
        break
      case 'reasoning':
        if (typeof part.text === 'string') out.push({ type: 'thinking', key, full: part.text })
        break
      case 'tool_use': {
        const state = rec(part.state)
        const status = state.status === 'completed' ? 'done' : state.status === 'error' ? 'error' : 'running'
        out.push({
          type: 'tool',
          id: s(part.callID) ?? key,
          name: s(part.tool),
          detail: s(state.title) ?? summarizeInput(state.input),
          output: typeof state.output === 'string' ? clip(state.output) : s(state.error),
          status
        })
        break
      }
      case 'error': {
        const error = rec(j.error)
        out.push({ type: 'error', message: s(rec(error.data).message) ?? s(error.message) ?? s(error.name) ?? 'OpenCode error' })
        break
      }
    }
    return out
  }
}

/** Gemini CLI / Qwen Code `--output-format stream-json`. */
export const geminiParser = (): LineParser => {
  let turn = 0
  return (line) => {
    const j = parseJson(line)
    if (!j) return plainError(line)
    switch (j.type) {
      case 'init':
        return s(j.session_id) ? [{ type: 'session', id: s(j.session_id) as string }] : []
      case 'message':
        if (j.role !== 'assistant' || typeof j.content !== 'string') return []
        return j.delta ? [{ type: 'text', key: `g${turn}`, delta: j.content }] : [{ type: 'text', key: `g${turn++}`, full: j.content }]
      case 'tool_use':
        turn++
        return [{ type: 'tool', id: s(j.tool_id) ?? 'tool', name: s(j.tool_name), detail: summarizeInput(j.parameters), status: 'running' }]
      case 'tool_result':
        return [{ type: 'tool', id: s(j.tool_id) ?? 'tool', output: typeof j.output === 'string' ? clip(j.output) : undefined, status: j.status === 'error' ? 'error' : 'done' }]
      case 'error':
        return [{ type: 'error', message: s(j.message) ?? 'Error' }]
      case 'result':
        return j.status === 'error' ? [{ type: 'error', message: s(rec(j.error).message) ?? 'Run failed' }, { type: 'done' }] : [{ type: 'done' }]
      default:
        return []
    }
  }
}

/** CLIs with plain-text print mode: every line is answer text. */
export const plainParser = (): LineParser => (line) => [{ type: 'text', key: 'plain', delta: `${line}\n` }]
