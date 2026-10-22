import { useState } from 'react'
import { router, Stack } from 'expo-router'
import { CalendarClock, Play, Plus } from 'lucide-react-native'
import type { RoutineView } from '@shared/domain/routine'
import { describeSchedule } from '@shared/domain/routine-text'
import { useAction, useCall } from '@/core/api'
import { routes } from '@/core/routes'
import { Button, EmptyState, IconButton, ListRow, Loading, Screen, Section } from '@/core/ui'

const LAST: Record<string, string> = { running: 'running now', completed: 'last run done', failed: 'last run failed', missed: 'last run missed', skipped: 'last run skipped' }

/** Its rule in words, and how its last run went. */
const describe = (r: RoutineView): string => [r.enabled ? describeSchedule(r) : 'Off', r.lastRun ? (LAST[r.lastRun.status] ?? r.lastRun.status) : null].filter(Boolean).join(' · ')

/**
 * Schedules on the phone (ADR 0052, 0053): every Schedule on the computer with its rule and last
 * run, and Run now; + makes one, a tap edits one.
 */
export function SchedulesScreen() {
  const routines = useCall('routines.list', {})
  const run = useAction('routines.runNow')
  const [refreshing, setRefreshing] = useState(false)
  const header = <Stack.Screen options={{ headerRight: () => <IconButton label="New schedule" icon={Plus} onPress={() => router.push(routes.schedule())} /> }} />

  if (routines.isLoading) return <Loading label="Loading schedules…" />
  const list = [...(routines.data ?? [])].sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name))
  if (!list.length) {
    return (
      <>
        {header}
        <EmptyState icon={CalendarClock} title="No schedules yet" body="Work a bot does on its own at set times." action={<Button label="New schedule" icon={Plus} variant="primary" onPress={() => router.push(routes.schedule())} />} />
      </>
    )
  }

  return (
    <>
      {header}
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
              onPress={() => router.push(routes.schedule(r.id))}
              action={
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
    </>
  )
}
