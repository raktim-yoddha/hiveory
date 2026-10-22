import { useState } from 'react'
import { CalendarClock, Play } from 'lucide-react-native'
import type { RoutineView } from '@shared/domain/routine'
import { useAction, useCall } from '@/core/api'
import { Button, EmptyState, ListRow, Loading, Screen, Section } from '@/core/ui'

const LAST: Record<string, string> = { running: 'running now', completed: 'last run done', failed: 'last run failed', missed: 'last run missed', skipped: 'last run skipped' }

/** When it runs next and how its last run went, in a few words. */
const describe = (r: RoutineView): string => {
  const next = !r.enabled ? 'Paused' : r.nextRunAt ? `Next ${new Date(r.nextRunAt).toLocaleString()}` : 'No more runs'
  return r.lastRun ? `${next} · ${LAST[r.lastRun.status] ?? r.lastRun.status}` : next
}

/**
 * Schedules on the phone (ADR 0052): every Schedule on the computer, when it runs next, and Run now.
 * Creating and editing them stays on the computer.
 */
export function SchedulesScreen() {
  const routines = useCall('routines.list', {})
  const run = useAction('routines.runNow')
  const [refreshing, setRefreshing] = useState(false)

  if (routines.isLoading) return <Loading label="Loading schedules…" />
  const list = [...(routines.data ?? [])].sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name))
  if (!list.length) return <EmptyState icon={CalendarClock} title="No schedules yet" body="Make one in Hiveory on your computer; it shows up here to follow and run." />

  return (
    <Screen
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true)
        void routines.refetch().finally(() => setRefreshing(false))
      }}
    >
      <Section>
        {list.map((r) => (
          <ListRow
            key={r.id}
            title={r.name}
            subtitle={describe(r)}
            trailing={
              <Button
                label="Run now"
                size="sm"
                icon={Play}
                loading={run.isPending && run.variables?.routineId === r.id}
                disabled={r.lastRun?.status === 'running'}
                onPress={() => run.mutate({ routineId: r.id })}
              />
            }
          />
        ))}
      </Section>
    </Screen>
  )
}
