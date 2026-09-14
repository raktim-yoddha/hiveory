import { lazy, Suspense } from 'react'
import { HiveoryGlobalDashboard } from '../dashboard/HiveoryGlobalDashboard'

export type GlobalDestination = 'dashboard' | 'automations' | 'plugins'

const HiveoryRoutines = lazy(async () => ({ default: (await import('../automations/views/HiveoryRoutines')).HiveoryRoutines }))
const HiveoryPlugins = lazy(async () => ({ default: (await import('../plugins/views/HiveoryPlugins')).HiveoryPlugins }))

export function HiveoryGlobalSurface({ destination, onOpenSource }: { destination: GlobalDestination; onOpenSource: (target: { source: string; workspaceId?: string; agentId?: string; routineId?: string; conversationId?: string }) => void }) {
  return <div className="hiveory-global-surface"><Suspense fallback={<div className="hiveory-screen-loading" role="status">Loading…</div>}>
    {destination === 'dashboard' && <HiveoryGlobalDashboard onOpenSource={onOpenSource} />}
    {destination === 'automations' && <HiveoryRoutines />}
    {destination === 'plugins' && <HiveoryPlugins />}
  </Suspense></div>
}
