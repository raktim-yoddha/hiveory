import { create } from 'zustand'
import type { ApprovalRequest } from '@shared/domain/approval'
import { api } from '../lib/api'
import { useBots } from './bots'
import { useNavigation } from './navigation'
import { reportError, runAction, useNotices } from './notices'

interface ApprovalsState {
  requests: ApprovalRequest[]
  load(): Promise<void>
  answer(approvalId: string, allow: boolean): Promise<void>
}

/** Bot calls waiting for the user's yes (ADR 0029). Main holds them; this mirrors them for the thread and the work board. */
export const useApprovals = create<ApprovalsState>((set, get) => ({
  requests: [],

  load: async () => {
    try {
      const requests = await api('approvals.list')
      const known = new Set(get().requests.map((r) => r.id))
      set({ requests })
      // Away from Bots, a new request still shows (the desktop notification covers Hiveory in the background).
      if (useNavigation.getState().mode === 'bots') return
      for (const r of requests.filter((x) => !known.has(x.id))) {
        const name = useBots.getState().bots.find((b) => b.id === r.botId)?.name ?? 'A bot'
        useNotices.getState().push({ level: 'warning', message: `${name} is waiting for you: allow ${r.tool}? Open Bots to answer.` })
      }
    } catch (error) {
      reportError(error, 'Load approvals')
    }
  },

  answer: async (approvalId, allow) => {
    await runAction(allow ? 'Allow' : 'Decline', () => api('approvals.answer', { approvalId, allow }))
    await get().load()
  }
}))
