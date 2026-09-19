export type DashboardSource = 'code' | 'agent' | 'chat' | 'automation'
export type DashboardGroup = 'attention' | 'working' | 'waiting' | 'recent'

export type DashboardItem = {
  id: string
  source: DashboardSource
  group: DashboardGroup
  title: string
  detail: string
  state: string
  updatedAt: number
  workspaceId?: string
  agentId?: string
  routineId?: string
  conversationId?: string
  runId?: string
}

export const DASHBOARD_ACTIVITY_WINDOW_MS = 48 * 60 * 60 * 1000

function requiresFreshActivity(group: DashboardGroup): boolean {
  return group === 'attention' || group === 'recent'
}

export function filterDashboardGroupItems(items: DashboardItem[], group: DashboardGroup, now = Date.now()): DashboardItem[] {
  const threshold = now - DASHBOARD_ACTIVITY_WINDOW_MS
  return items
    .filter((item) => {
      if (item.group !== group || !Number.isFinite(item.updatedAt) || item.updatedAt <= 0) return false
      return !requiresFreshActivity(group) || item.updatedAt >= threshold
    })
    .sort((left, right) => right.updatedAt - left.updatedAt)
}
