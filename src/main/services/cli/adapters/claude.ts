import { GENERIC_WAITING_PATTERNS } from '../status/heuristics'
import { officialIcon } from './icons'
import type { StatusEvent } from '../status/status-machine'
import { claudeMcpArgs, MCP_TOOL_TIMEOUT_MS, mcpServersJson } from './mcp-injection'
import { curlHookCommand, field, inDir, type CliAdapter } from './types'

const HOOK_EVENTS = [
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PermissionRequest',
  'Notification',
  'Stop'
] as const

const TRUST_PROMPT = { pattern: /one you trust\?|Do you trust the files/i, reason: 'confirmation' as const }

/** Tools that hand control back to the user rather than doing work. */
const USER_TOOLS: Record<string, StatusEvent> = {
  AskUserQuestion: { type: 'needs-user', reason: 'input' },
  ExitPlanMode: { type: 'needs-user', reason: 'confirmation', activity: 'Waiting for plan approval' }
}

export const mapClaudeHookEvent = (event: string, payload: unknown): StatusEvent | null => {
  const tool = field(payload, 'tool_name')
  switch (event) {
    case 'UserPromptSubmit':
      return { type: 'working', activity: 'Thinking' }
    case 'PreToolUse':
      return (tool && USER_TOOLS[tool]) || { type: 'working', activity: tool ? `Using ${tool}` : undefined }
    case 'PostToolUse':
      return { type: 'working' }
    case 'PermissionRequest':
      return { type: 'needs-user', reason: 'permission', activity: tool ? `Permission for ${tool}` : undefined }
    case 'Notification': {
      const kind = field(payload, 'notification_type')
      if (kind === 'permission_prompt') return { type: 'needs-user', reason: 'permission' }
      if (kind === 'elicitation_dialog') return { type: 'needs-user', reason: 'input' }
      if (!kind && /permission/i.test(field(payload, 'message') ?? '')) {
        return { type: 'needs-user', reason: 'permission' }
      }
      return null
    }
    case 'Stop':
      return { type: 'turn-complete' }
    default:
      return null
  }
}

export const claudeAdapter: CliAdapter = {
  id: 'claude',
  displayName: 'Claude Code',
  icon: officialIcon('claude', 'CC'),
  executables: ['claude'],
  supportsAutoApprove: true,
  injectMcp: true,

  skills: { dir: '.claude/skills' },
  // A session from its history: Claude takes Hiveory's conversation id as its own session id.
  adoptSession: (sessionId) => ({ conversationId: sessionId }),
  buildLaunch({ instance, autoApprove, hook, mcp, runtimeDir, resume }) {
    // Hiveory picks the session id up front, so every agent resumes exactly its own conversation.
    const args = resume
      ? ['--resume', instance.conversationId]
      : ['--session-id', instance.conversationId]
    if (autoApprove) args.push('--dangerously-skip-permissions')
    const files: Array<{ path: string; content: string }> = []
    if (hook) {
      // Hooks are injected per launch via --settings; the user's own settings are never modified.
      const settingsPath = inDir(runtimeDir, 'claude-hooks.json')
      const hooks = Object.fromEntries(
        HOOK_EVENTS.map((event) => [
          event,
          [{ matcher: '*', hooks: [{ type: 'command', command: curlHookCommand(hook, instance.id, event) }] }]
        ])
      )
      files.push({ path: settingsPath, content: JSON.stringify({ hooks }, null, 2) })
      args.push('--settings', settingsPath)
    }
    const env: Record<string, string | undefined> = { CLAUDECODE: undefined }
    if (mcp) {
      // Agent tools: Hiveory's MCP server, pre-approved so coordination never stalls on a prompt.
      const mcpPath = inDir(runtimeDir, 'hiveory-mcp.json')
      files.push({ path: mcpPath, content: JSON.stringify(mcpServersJson(mcp), null, 2) })
      args.push(...claudeMcpArgs(mcp, mcpPath))
      env.MCP_TOOL_TIMEOUT = String(MCP_TOOL_TIMEOUT_MS)
    }
    // Launching Hiveory from inside a Claude Code session must not block nested agents.
    return { args, files, env }
  },

  mapHookEvent: mapClaudeHookEvent,

  heuristics(hooksActive) {
    // Hooks cover the turn lifecycle, but the folder-trust prompt and user
    // interrupts fire none. Claude animates continuously while working, so a
    // long silence reliably means the turn is over.
    if (hooksActive) {
      return {
        waitingPatterns: [TRUST_PROMPT],
        workingOnSubmit: false,
        idleAfterSilenceMs: 8000,
        idlePatterns: [/Interrupted/]
      }
    }
    return {
      waitingPatterns: [
        TRUST_PROMPT,
        { pattern: /Do you want to (?:proceed|make this edit|create|allow)/i, reason: 'permission' },
        ...GENERIC_WAITING_PATTERNS
      ],
      workingOnSubmit: true,
      idleAfterSilenceMs: 4000,
      idlePatterns: [/Interrupted/]
    }
  }
}
