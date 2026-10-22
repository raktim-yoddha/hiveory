import { useState } from 'react'
import { router, Stack } from 'expo-router'
import { Check, Play, Trash2 } from 'lucide-react-native'
import { INTERVAL_MINUTES, MAX_ROUTINE_NAME, MAX_ROUTINE_PROMPT, type RoutineSchedule, type RoutineView } from '@shared/domain/routine'
import { compileRepeat, describeSchedule, localZone, when, WEEKDAYS } from '@shared/domain/routine-text'
import { useAction, useCall } from '@/core/api'
import { useTheme } from '@/core/theme'
import { Button, confirm, ListRow, Loading, Screen, Section, Segmented, SwitchRow, Text, TextField } from '@/core/ui'

type Repeat = 'once' | 'interval' | 'daily' | 'weekdays' | 'weekly'
const REPEATS: { value: Repeat; label: string }[] = [
  { value: 'once', label: 'Once' },
  { value: 'interval', label: 'Every' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekly', label: 'Weekly' }
]
const STATUS: Record<string, string> = { running: 'Running', completed: 'Done', failed: 'Failed', missed: 'Missed', skipped: 'Skipped' }

const pad = (n: number): string => String(n).padStart(2, '0')
const dateOf = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const timeOf = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`
/** The typed date and time on this phone's clock; null while they are not a real moment. */
const moment = (date: string, time: string): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(time)) return null
  const d = new Date(`${date}T${time.padStart(5, '0')}:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

/** A new Schedule: daily, from the next full hour. */
const fresh = (): Draft => {
  const soon = new Date(Date.now() + 60 * 60_000)
  soon.setMinutes(0)
  return { name: '', prompt: '', botId: '', repeat: 'daily', date: dateOf(soon), time: timeOf(soon), every: '60', enabled: true }
}

interface Draft {
  name: string
  prompt: string
  botId: string
  repeat: Repeat
  date: string
  time: string
  every: string
  enabled: boolean
}

const fromRoutine = (r: RoutineView): Draft => {
  const start = new Date(r.startsAt)
  const s = r.schedule
  const repeat: Repeat = s.kind === 'once' ? 'once' : s.kind === 'interval' ? 'interval' : s.preset === 'daily' || s.preset === 'weekdays' || s.preset === 'weekly' ? s.preset : 'daily'
  return { name: r.name, prompt: r.prompt, botId: r.botId ?? '', repeat, date: dateOf(start), time: timeOf(start), every: s.kind === 'interval' ? String(s.everyMinutes) : '60', enabled: r.enabled }
}

/**
 * A Schedule made or edited from the phone (ADR 0053): who does it (a bot), what it is asked, and
 * when: once, every few minutes, daily, on weekdays or weekly, in this phone's time zone. Rules the
 * phone has no words for (monthly, custom cron) keep theirs unless the timing is changed here.
 * Below, its recent runs.
 */
export function ScheduleEditScreen({ routineId }: { routineId?: string }) {
  const { colors } = useTheme()
  const routines = useCall('routines.list', {})
  const bots = useCall('bots.list', undefined)
  const runs = useCall('routines.runs', { routineId }, { enabled: Boolean(routineId) })
  const create = useAction('routines.create')
  const update = useAction('routines.update')
  const remove = useAction('routines.delete')
  const run = useAction('routines.runNow')
  const routine = routineId ? routines.data?.find((r) => r.id === routineId) : undefined
  const [draft, setDraft] = useState<Draft | null>(() => (routineId ? null : fresh()))
  const [timingTouched, setTimingTouched] = useState(false)

  // The Schedule's own values once loaded (set while rendering, not in an effect).
  if (!draft && routine) setDraft(fromRoutine(routine))

  if (!draft || bots.isLoading) return <Loading />
  const set = (patch: Partial<Draft>): void => setDraft({ ...draft, ...patch })
  const timing = (patch: Partial<Draft>): void => {
    setTimingTouched(true)
    set(patch)
  }
  const start = draft.repeat === 'interval' ? new Date() : moment(draft.date, draft.time)
  const every = Number(draft.every)
  const everyOk = Number.isInteger(every) && every >= INTERVAL_MINUTES.min && every <= INTERVAL_MINUTES.max
  const zone = localZone()
  const schedule = (at: Date): RoutineSchedule =>
    draft.repeat === 'once' ? { kind: 'once' } : draft.repeat === 'interval' ? { kind: 'interval', everyMinutes: every } : { kind: 'cron', expr: compileRepeat(draft.repeat, at, zone), preset: draft.repeat }
  const ready = draft.name.trim() && draft.prompt.trim() && (routine?.target || draft.botId) && start && (draft.repeat !== 'interval' || everyOk)

  const save = (): void => {
    if (!ready || !start) return
    const timingFields = { schedule: schedule(start), startsAt: start.toISOString(), timezone: zone }
    if (routineId) {
      update.mutate(
        { routineId, name: draft.name.trim(), prompt: draft.prompt.trim(), enabled: draft.enabled, ...(draft.botId ? { botId: draft.botId } : {}), ...(timingTouched ? timingFields : {}) },
        { onSuccess: () => router.back() }
      )
    } else {
      create.mutate({ name: draft.name.trim(), prompt: draft.prompt.trim(), botId: draft.botId, enabled: draft.enabled, ...timingFields }, { onSuccess: () => router.back() })
    }
  }

  // A rule the phone has no words for (monthly, custom) stays until the timing is changed here.
  const kept = Boolean(routine && !timingTouched && routine.schedule.kind === 'cron' && !['daily', 'weekdays', 'weekly'].includes(routine.schedule.preset))
  const able = (bots.data ?? []).filter((b) => b.routines || b.id === draft.botId)
  return (
    <>
      <Stack.Screen options={{ title: routineId ? (routine?.name ?? 'Schedule') : 'New schedule' }} />
      <Screen>
        <Section>
          <TextField label="Name" value={draft.name} onChangeText={(name) => set({ name })} maxLength={MAX_ROUTINE_NAME} />
          <TextField label="What to do" placeholder="What the bot is asked on every run" value={draft.prompt} onChangeText={(prompt) => set({ prompt })} maxLength={MAX_ROUTINE_PROMPT} multiline />
        </Section>
        {routine?.target ? (
          <Section title="Who does it">
            <Text tone="muted">{routine.target.kind === 'chat' ? 'A new chat each run' : 'A Work agent'} — change it on the computer.</Text>
          </Section>
        ) : (
          <Section title="Who does it">
            {able.length ? (
              able.map((b) => <ListRow key={b.id} title={b.name} subtitle={b.blurb} trailing={draft.botId === b.id ? <Check size={18} color={colors.accent} /> : null} onPress={() => set({ botId: b.id })} />)
            ) : (
              <Text tone="muted">No bot may run on a schedule yet: turn on “Run on a schedule” in a bot’s settings.</Text>
            )}
          </Section>
        )}
        <Section title="When">
          <Segmented label="Repeat" value={draft.repeat} onChange={(repeat) => timing({ repeat })} options={REPEATS} />
          {kept ? <Text tone="waiting">Now: {describeSchedule(routine!)}. Pick a repeat here to replace it.</Text> : null}
          {draft.repeat === 'interval' ? (
            <TextField label="Minutes between runs" keyboardType="number-pad" value={draft.every} onChangeText={(v) => timing({ every: v.replace(/\D/g, '') })} hint={`${INTERVAL_MINUTES.min} to ${INTERVAL_MINUTES.max}, starting now.`} />
          ) : (
            <>
              <TextField label={draft.repeat === 'once' ? 'Date' : 'Starting'} placeholder="YYYY-MM-DD" value={draft.date} onChangeText={(date) => timing({ date })} mono />
              <TextField label="Time" placeholder="HH:MM" value={draft.time} onChangeText={(time) => timing({ time })} mono />
            </>
          )}
          <Text tone="muted">
            {!start
              ? 'Type the date as 2026-10-22 and the time as 09:30.'
              : draft.repeat === 'once'
                ? `Once, ${when(start.toISOString())}`
                : draft.repeat === 'weekly'
                  ? `Every ${WEEKDAYS[start.getDay()]} at ${timeOf(start)}`
                  : draft.repeat === 'interval'
                    ? `Every ${draft.every || '…'} minutes`
                    : `${draft.repeat === 'daily' ? 'Every day' : 'Monday to Friday'} at ${timeOf(start)}`}{' '}
            ({zone})
          </Text>
          <SwitchRow label="On" value={draft.enabled} onChange={(enabled) => set({ enabled })} />
        </Section>
        <Button label={routineId ? 'Save' : 'Create schedule'} variant="primary" block disabled={!ready} loading={create.isPending || update.isPending} onPress={save} />
        {routineId ? (
          <>
            <Button label="Run now" icon={Play} block loading={run.isPending} onPress={() => run.mutate({ routineId })} />
            <Button
              label="Delete schedule"
              icon={Trash2}
              variant="danger"
              block
              onPress={() => confirm(`Delete ${routine?.name ?? 'this schedule'}?`, 'Runs already done stay in their threads.', 'Delete', () => remove.mutate({ routineId }, { onSuccess: () => router.back() }))}
            />
            <Section title="Recent runs">
              {(runs.data ?? []).slice(0, 20).map((r) => (
                <ListRow key={r.id} title={`${STATUS[r.status] ?? r.status} · ${when(r.startedAt ?? r.scheduledFor)}`} subtitle={r.detail} />
              ))}
              {runs.data && !runs.data.length ? <Text tone="muted">No runs yet.</Text> : null}
            </Section>
          </>
        ) : null}
      </Screen>
    </>
  )
}
