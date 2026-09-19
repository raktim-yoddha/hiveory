import { lazy, Suspense } from 'react'
import { HiveoryGlobalDashboard } from '../dashboard/HiveoryGlobalDashboard'
import { HiveoryLoadingState } from '../../../shared/ui/HiveoryDesign'

const HiveoryRoutines = lazy(async () => ({ default: (await import('../automations/views/HiveoryRoutines')).HiveoryRoutines }))
const HiveoryPlugins = lazy(async () => ({ default: (await import('../plugins/views/HiveoryPlugins')).HiveoryPlugins }))
const HiveoryTasks = lazy(async () => ({ default: (await import('../tasks/views/HiveoryTasks')).HiveoryTasks }))

export type GlobalDestination = 'dashboard' | 'automations' | 'plugins' | 'tasks'

export function HiveoryGlobalSurface({ destination, onOpenSource, onOpenWorkspace, onStartLocalWork }: { destination: GlobalDestination; onOpenSource: (target: { source: string; workspaceId?: string; agentId?: string; routineId?: string; conversationId?: string }) => void; onOpenWorkspace: (workspaceId: string) => void; onStartLocalWork: () => void }) {
  return <div className="hiveory-global-surface"><Suspense fallback={<HiveoryLoadingState label="Loading page…" className="hiveory-screen-loading" />}>
    {destination === 'dashboard' && <HiveoryGlobalDashboard onOpenSource={onOpenSource} />}
    {destination === 'automations' && <HiveoryRoutines />}
    {destination === 'plugins' && <HiveoryPlugins />}
    {destination === 'tasks' && <HiveoryTasks onOpenWorkspace={onOpenWorkspace} onStartLocalWork={onStartLocalWork} />}
  </Suspense></div>
}
