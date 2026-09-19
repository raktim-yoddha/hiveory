import { describe, expect, it } from 'vitest'
import { DASHBOARD_ACTIVITY_WINDOW_MS, filterDashboardGroupItems, type DashboardItem } from './dashboard-utils'

const now = Date.UTC(2026, 8, 16, 12, 0, 0)

function item(overrides: Partial<DashboardItem>): DashboardItem {
  return {
    id: 'item',
    source: 'code',
    group: 'recent',
    title: 'Work item',
    detail: 'Work details',
    state: 'completed',
    updatedAt: now,
    ...overrides,
  }
}

describe('dashboard activity filtering', () => {
  it('keeps fresh activity and removes stale attention and recent history', () => {
    const items = [
      item({ id: 'fresh-recent', updatedAt: now - 60_000 }),
      item({ id: 'boundary-recent', updatedAt: now - DASHBOARD_ACTIVITY_WINDOW_MS }),
      item({ id: 'stale-recent', updatedAt: now - DASHBOARD_ACTIVITY_WINDOW_MS - 1 }),
      item({ id: 'fresh-attention', group: 'attention', state: 'failed', updatedAt: now - 60_000 }),
      item({ id: 'stale-attention', group: 'attention', state: 'failed', updatedAt: now - 3 * DASHBOARD_ACTIVITY_WINDOW_MS }),
    ]

    expect(filterDashboardGroupItems(items, 'recent', now).map(({ id }) => id)).toEqual(['fresh-recent', 'boundary-recent'])
    expect(filterDashboardGroupItems(items, 'attention', now).map(({ id }) => id)).toEqual(['fresh-attention'])
  })

  it('does not let invalid timestamps reach the dashboard', () => {
    const items = [item({ id: 'missing', updatedAt: Number.NaN }), item({ id: 'zero', updatedAt: 0 })]

    expect(filterDashboardGroupItems(items, 'recent', now)).toEqual([])
  })

  it('keeps live work visible even when its last update is older than the activity window', () => {
    const stale = now - 3 * DASHBOARD_ACTIVITY_WINDOW_MS
    const items = [
      item({ id: 'working', group: 'working', state: 'running', updatedAt: stale }),
      item({ id: 'waiting', group: 'waiting', state: 'queued', updatedAt: stale }),
    ]

    expect(filterDashboardGroupItems(items, 'working', now).map(({ id }) => id)).toEqual(['working'])
    expect(filterDashboardGroupItems(items, 'waiting', now).map(({ id }) => id)).toEqual(['waiting'])
  })
})
