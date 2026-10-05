import { open, readdir, readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { AgentSession } from '@shared/domain'

/**
 * Readers for each CLI's own session history on disk. Every format is the CLI's
 * private one, so parsing is tolerant: an unreadable file or line is skipped,
 * never an error. Big files are read only at their head and tail.
 */

const HEAD_BYTES = 96 * 1024
const TAIL_BYTES = 384 * 1024
/** Newest files per CLI; older history is rarely wanted and slows the list. */
export const MAX_FILES = 400

type Json = Record<string, unknown>
const obj = (v: unknown): Json => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Json) : {})
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined)

const parseLines = (text: string): Json[] =>
  text.split('\n').flatMap((line) => {
    if (!line.startsWith('{')) return []
    try {
      return [obj(JSON.parse(line))]
    } catch {
      return []
    }
  })

/** The first and last lines of a JSONL file (partial lines at the cut are dropped). */
export async function headAndTail(file: string, size: number): Promise<{ head: Json[]; tail: Json[] }> {
  const handle = await open(file, 'r')
  try {
    const read = async (at: number, length: number): Promise<string> => {
      const buffer = Buffer.alloc(length)
      const { bytesRead } = await handle.read(buffer, 0, length, at)
      return buffer.subarray(0, bytesRead).toString('utf8')
    }
    if (size <= HEAD_BYTES + TAIL_BYTES) {
      const all = parseLines(await read(0, size))
      return { head: all, tail: all }
    }
    const head = await read(0, HEAD_BYTES)
    const tail = await read(size - TAIL_BYTES, TAIL_BYTES)
    return { head: parseLines(head.slice(0, head.lastIndexOf('\n'))), tail: parseLines(tail.slice(tail.indexOf('\n') + 1)) }
  } finally {
    await handle.close()
  }
}

/** Plain text of a message's content: a string, or the text parts of a content array. */
const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      const p = obj(part)
      return str(p.text) ?? (typeof p.content === 'string' ? p.content : '')
    })
    .filter(Boolean)
    .join(' ')
}

/** Something the user typed, not a tool result, a slash command's echo or injected context. */
const isPrompt = (text: string): boolean => {
  const t = text.trim()
  return t.length > 0 && !t.startsWith('<') && !t.startsWith('Caveat:') && !/^\[Request interrupted/.test(t)
}

const oneLine = (text: string, max = 240): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/** Files in a folder tree with their stats, newest first, at most `limit`. */
export async function newestFiles(root: string, match: (name: string) => boolean, depth: number, limit = MAX_FILES): Promise<Array<{ file: string; mtimeMs: number; size: number }>> {
  const found: Array<{ file: string; mtimeMs: number; size: number }> = []
  const walk = async (dir: string, level: number): Promise<void> => {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (level < depth) await walk(path, level + 1)
      } else if (entry.isFile() && match(entry.name)) {
        try {
          const s = await stat(path)
          found.push({ file: path, mtimeMs: s.mtimeMs, size: s.size })
        } catch {
          // Gone between listing and stat.
        }
      }
    }
  }
  await walk(root, 0)
  return found.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, limit)
}

export interface SessionReader {
  cliId: string
  /** Candidate files, newest first. */
  files(home: string): Promise<Array<{ file: string; mtimeMs: number; size: number }>>
  read(file: string, size: number, mtimeMs: number, home: string): Promise<AgentSession | null>
}

/** Claude Code: ~/.claude/projects/<folder>/<session id>.jsonl, one JSON record per line. */
export const claudeReader: SessionReader = {
  cliId: 'claude',
  files: (home) => newestFiles(join(home, '.claude', 'projects'), (n) => n.endsWith('.jsonl'), 1),
  async read(file, size, mtimeMs) {
    const { head, tail } = await headAndTail(file, size)
    const cwd = [...head, ...tail].map((l) => str(l.cwd)).find(Boolean)
    if (!cwd) return null
    const prompt = (l: Json): string | undefined => {
      // Tool results and the summary a compacted session starts with are not things the user typed.
      if (l.type !== 'user' || l.isSidechain || l.isMeta || l.isCompactSummary) return undefined
      const content = obj(l.message).content
      if (Array.isArray(content) && content.some((part) => obj(part).type === 'tool_result')) return undefined
      const text = textOf(content)
      return isPrompt(text) ? text : undefined
    }
    let title: string | undefined
    let preview: AgentSession['preview']
    let model: string | undefined
    let updatedAt: string | undefined
    for (const l of [...tail].reverse()) {
      title ??= str(l.customTitle) ?? (l.type === 'summary' ? str(l.summary) : undefined)
      updatedAt ??= str(l.timestamp)
      if (l.type === 'assistant' && !l.isSidechain) {
        model ??= str(obj(l.message).model)
        const text = textOf(obj(l.message).content)
        if (!preview && text.trim()) preview = { from: 'agent', text: oneLine(text) }
      }
      const asked = prompt(l)
      if (!preview && asked) preview = { from: 'you', text: oneLine(asked) }
    }
    const first = head.map(prompt).find(Boolean)
    if (!title && !first) return null
    return {
      id: basename(file, '.jsonl'),
      cliId: 'claude',
      title: oneLine(title ?? first!, 120),
      ...(preview ? { preview } : {}),
      cwd,
      ...(model && model !== '<synthetic>' ? { model } : {}),
      startedAt: head.map((l) => str(l.timestamp)).find(Boolean),
      updatedAt: updatedAt ?? new Date(mtimeMs).toISOString()
    }
  }
}

/** Codex: ~/.codex/sessions/YYYY/MM/DD/rollout-…-<id>.jsonl, titles in ~/.codex/session_index.jsonl. */
export function codexReader(): SessionReader {
  let titles: { at: number; map: Map<string, string> } | null = null
  const titleOf = async (home: string, id: string): Promise<string | undefined> => {
    if (!titles || Date.now() - titles.at > 5000) {
      const map = new Map<string, string>()
      try {
        for (const l of parseLines(await readFile(join(home, '.codex', 'session_index.jsonl'), 'utf8'))) {
          const sid = str(l.id)
          const name = str(l.thread_name)
          if (sid && name) map.set(sid, name)
        }
      } catch {
        // No index: titles fall back to the first prompt.
      }
      titles = { at: Date.now(), map }
    }
    return titles.map.get(id)
  }
  return {
    cliId: 'codex',
    files: (home) => newestFiles(join(home, '.codex', 'sessions'), (n) => n.startsWith('rollout-') && n.endsWith('.jsonl'), 3),
    async read(file, size, mtimeMs, home) {
      const { head, tail } = await headAndTail(file, size)
      const meta = obj(head.find((l) => l.type === 'session_meta')?.payload)
      const id = str(meta.id) ?? str(meta.session_id)
      const cwd = str(meta.cwd)
      if (!id || !cwd) return null
      const message = (l: Json): { role: string; text: string } | null => {
        const p = obj(l.payload)
        if (l.type !== 'response_item' || p.type !== 'message') return null
        const text = textOf(p.content)
        return typeof p.role === 'string' && text ? { role: p.role, text } : null
      }
      let preview: AgentSession['preview']
      let model: string | undefined
      let updatedAt: string | undefined
      for (const l of [...tail].reverse()) {
        updatedAt ??= str(l.timestamp)
        if (l.type === 'turn_context') model ??= str(obj(l.payload).model)
        const m = message(l)
        if (!preview && m?.role === 'assistant') preview = { from: 'agent', text: oneLine(m.text) }
        if (!preview && m?.role === 'user' && isPrompt(m.text)) preview = { from: 'you', text: oneLine(m.text) }
      }
      model ??= head.map((l) => (l.type === 'turn_context' ? str(obj(l.payload).model) : undefined)).find(Boolean)
      const first = head.map(message).find((m) => m?.role === 'user' && isPrompt(m.text))?.text
      const title = (await titleOf(home, id)) ?? first
      if (!title) return null
      return {
        id,
        cliId: 'codex',
        title: oneLine(title, 120),
        ...(preview ? { preview } : {}),
        cwd,
        ...(model ? { model } : {}),
        startedAt: str(meta.timestamp),
        updatedAt: updatedAt ?? new Date(mtimeMs).toISOString()
      }
    }
  }
}

/** Gemini CLI: ~/.gemini/tmp/<project>/chats/session-*.json; ~/.gemini/projects.json maps folders to <project>. */
export function geminiReader(): SessionReader {
  const folderOf = async (home: string, file: string): Promise<string | undefined> => {
    const project = basename(join(file, '..', '..'))
    try {
      const map = obj(obj(JSON.parse(await readFile(join(home, '.gemini', 'projects.json'), 'utf8'))).projects)
      return Object.entries(map).find(([, short]) => short === project)?.[0]
    } catch {
      return undefined
    }
  }
  return {
    cliId: 'gemini',
    files: (home) => newestFiles(join(home, '.gemini', 'tmp'), (n) => n.startsWith('session-') && (n.endsWith('.json') || n.endsWith('.jsonl')), 2),
    async read(file, size, mtimeMs, home) {
      if (size > 32 * 1024 * 1024) return null
      const raw = await readFile(file, 'utf8')
      let doc: Json
      let messages: Json[]
      if (file.endsWith('.jsonl')) {
        const lines = parseLines(raw)
        doc = lines.find((l) => l.sessionId) ?? {}
        messages = lines.filter((l) => l.type === 'user' || l.type === 'gemini')
      } else {
        try {
          doc = obj(JSON.parse(raw))
        } catch {
          return null
        }
        messages = (Array.isArray(doc.messages) ? doc.messages : []).map(obj)
      }
      const id = str(doc.sessionId)
      const cwd = await folderOf(home, file)
      const prompts = messages.filter((m) => m.type === 'user').map((m) => textOf(m.content)).filter(isPrompt)
      if (!id || !cwd || !prompts.length) return null
      const last = messages.at(-1)
      const lastText = last ? textOf(last.content) : ''
      return {
        id,
        cliId: 'gemini',
        title: oneLine(str(doc.summary) ?? prompts[0]!, 120),
        ...(lastText ? { preview: { from: last?.type === 'user' ? 'you' : 'agent', text: oneLine(lastText) } } : {}),
        cwd,
        ...([...messages].reverse().map((m) => str(m.model)).find(Boolean) ? { model: [...messages].reverse().map((m) => str(m.model)).find(Boolean)! } : {}),
        startedAt: str(doc.startTime),
        updatedAt: str(doc.lastUpdated) ?? new Date(mtimeMs).toISOString()
      }
    }
  }
}
