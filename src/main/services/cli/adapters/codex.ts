import { GENERIC_WAITING_PATTERNS } from '../status/heuristics'
import { ICON_PATHS } from './icon-paths'
import { field, type CliAdapter } from './types'

export const codexAdapter: CliAdapter = {
  id: 'codex',
  displayName: 'Codex',
  icon: { kind: 'svg', viewBox: '0 0 24 24', path: ICON_PATHS.openai, color: '#E8E3DA' },
  executables: ['codex'],
  supportsAutoApprove: true,

  buildLaunch({ instance, autoApprove, hook }) {
    const args: string[] = []
    if (hook) {
      // Codex runs `notify` with the event JSON appended as the final argument.
      const notify = [
        'curl', '-s', '-m', '2', '-X', 'POST',
        '-H', `X-Hiveory-Token: ${hook.token}`,
        `${hook.baseUrl}/hooks/${instance.id}/notify`,
        '--data-binary'
      ]
      args.push('-c', `notify=${JSON.stringify(notify)}`)
    }
    if (autoApprove) args.push('--dangerously-bypass-approvals-and-sandbox')
    return { args }
  },

  mapHookEvent(_event, payload) {
    return field(payload, 'type') === 'agent-turn-complete' ? { type: 'turn-complete' } : null
  },

  heuristics() {
    // notify only reports turn completion; working/waiting come from the PTY.
    return {
      waitingPatterns: [
        { pattern: /Would you like to (?:run|make|apply)|Allow command\?|approve this/i, reason: 'permission' },
        ...GENERIC_WAITING_PATTERNS
      ],
      workingOnSubmit: true,
      idleAfterSilenceMs: 5000
    }
  }
}
