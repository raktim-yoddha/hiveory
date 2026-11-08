/**
 * hiveory:// links (ADR 0061): open a Workspace or worktree from anywhere (another app, a note, the
 * taskbar's jump list), or start a chat with a prompt ready to send. A link never runs anything: a
 * prompt lands in the message box as a draft, and the user presses Send. Dependency-free.
 */

export type HiveoryLink =
  | { kind: 'open'; projectId: string; workspaceId?: string }
  | { kind: 'new'; prompt: string; projectId?: string; workspaceId?: string }

export const LINK_SCHEME = 'hiveory'
/** A prompt link carries at most this much text. */
export const MAX_LINK_PROMPT = 8000
const ID = /^[A-Za-z0-9_-]{1,128}$/

const idParam = (params: URLSearchParams, name: string): string | undefined => {
  const value = params.get(name)
  return value && ID.test(value) ? value : undefined
}

/** A hiveory:// link, or null for anything else (another scheme, a pairing link, a bad id, an empty prompt). */
export function parseHiveoryLink(raw: string): HiveoryLink | null {
  if (typeof raw !== 'string' || raw.length > MAX_LINK_PROMPT * 4 + 512) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== `${LINK_SCHEME}:`) return null
  // hiveory://open?… parses as host "open"; hiveory:open?… as pathname "open".
  const action = (url.host || url.pathname).replace(/^\/+|\/+$/g, '').toLowerCase()
  const projectId = idParam(url.searchParams, 'p')
  const workspaceId = idParam(url.searchParams, 'w')
  if (action === 'open') return projectId ? { kind: 'open', projectId, ...(workspaceId ? { workspaceId } : {}) } : null
  if (action === 'new') {
    const prompt = (url.searchParams.get('prompt') ?? '').replace(/\r\n?/g, '\n').trim()
    if (!prompt || prompt.length > MAX_LINK_PROMPT) return null
    return { kind: 'new', prompt, ...(projectId ? { projectId } : {}), ...(workspaceId ? { workspaceId } : {}) }
  }
  return null
}

/** The first hiveory:// link among a process's arguments (Windows and Linux pass a clicked link this way). */
export const linkFromArgv = (argv: readonly string[]): HiveoryLink | null => {
  for (const arg of argv) {
    if (typeof arg === 'string' && arg.toLowerCase().startsWith(`${LINK_SCHEME}:`)) {
      const link = parseHiveoryLink(arg)
      if (link) return link
    }
  }
  return null
}

/** A link that opens a Workspace (and one of its worktrees). */
export const openLink = (projectId: string, workspaceId?: string): string =>
  `${LINK_SCHEME}://open?p=${encodeURIComponent(projectId)}${workspaceId ? `&w=${encodeURIComponent(workspaceId)}` : ''}`

/** A link that starts a chat with `prompt` as its draft, in a worktree when given. */
export const promptLink = (prompt: string, target?: { projectId: string; workspaceId?: string }): string =>
  `${LINK_SCHEME}://new?prompt=${encodeURIComponent(prompt.slice(0, MAX_LINK_PROMPT))}${target ? `&p=${encodeURIComponent(target.projectId)}${target.workspaceId ? `&w=${encodeURIComponent(target.workspaceId)}` : ''}` : ''}`
