import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { cacheShare, compactTokens, groupUsage, localDay, splitModelKey, totalTokens, USAGE_DAYS, type UsageGroup, type UsageReport } from '@shared/domain/usage'
import { IconButton } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Tabs } from '../../components/ui/Tabs'
import { api } from '../../lib/api'
import { useClis } from '../../stores/data'
import { SettingsPage } from './SettingsPage'
import styles from './Usage.module.css'

type Days = `${(typeof USAGE_DAYS)[number]}`
const LABEL: Record<Days, string> = { '1': 'Today', '7': '7 days', '30': '30 days', '90': '90 days' }
const exact = new Intl.NumberFormat()

/** Every day from `since` to today, so a quiet day still shows as an empty bar. */
const daysFrom = (since: string): string[] => {
  const out: string[] = []
  const [y, m, d] = since.split('-').map(Number)
  const day = new Date(y!, m! - 1, d!)
  const today = localDay(new Date())
  while (localDay(day) <= today && out.length < 92) {
    out.push(localDay(day))
    day.setDate(day.getDate() + 1)
  }
  return out
}

/**
 * Settings › Usage (ADR 0060): tokens per day, CLI and model, read from the CLIs' own history where
 * Hiveory runs. Counts only, never prices: Hiveory cannot know a plan's real cost.
 */
export function UsageSection() {
  const [days, setDays] = useState<Days>('7')
  const [report, setReport] = useState<UsageReport>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const clis = useClis((s) => s.clis)
  const name = (cliId: string): string => clis.find((c) => c.id === cliId)?.displayName ?? cliId

  useEffect(() => {
    let live = true
    void api('usage.report', { days: Number(days) })
      .then((r) => {
        if (!live) return
        setReport(r)
        setError(undefined)
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [days, tick])

  const view = useMemo(() => {
    if (!report) return undefined
    const all = groupUsage(report.rows, 'cliId').reduce<UsageGroup>(
      (sum, g) => ({ ...sum, input: sum.input + g.input, output: sum.output + g.output, cacheRead: sum.cacheRead + g.cacheRead, cacheWrite: sum.cacheWrite + g.cacheWrite, replies: sum.replies + g.replies }),
      { key: 'all', input: 0, output: 0, cacheRead: 0, cacheWrite: 0, replies: 0 }
    )
    const byDay = new Map(groupUsage(report.rows, 'day').map((g) => [g.key, g]))
    const daily = daysFrom(report.since).map((day) => ({ day, total: byDay.has(day) ? totalTokens(byDay.get(day)!) : 0 }))
    return { all, daily, peak: Math.max(1, ...daily.map((d) => d.total)), byCli: groupUsage(report.rows, 'cliId'), byModel: groupUsage(report.rows, 'model') }
  }, [report])

  const refresh = (): void => {
    setLoading(true)
    setTick((t) => t + 1)
  }

  return (
    <SettingsPage title="Usage" description="Tokens your agents used, read from Claude Code, Codex and Gemini CLI history on the computer Hiveory runs on. Counts only; your plan decides what they cost.">
      <div className={styles.bar}>
        <Tabs
          label="Period"
          variant="segmented"
          value={days}
          onChange={(v) => {
            setLoading(true)
            setDays(v)
          }}
          options={USAGE_DAYS.map((d) => ({ value: `${d}` as Days, label: LABEL[`${d}`] }))}
        />
        <span className={styles.flex} />
        <IconButton label="Read usage again" icon={<RefreshCw className={loading ? 'spin' : undefined} />} onClick={refresh} />
      </div>
      {error && !report ? (
        <EmptyState compact title="Could not read usage" description={error} />
      ) : !view ? (
        <div className={styles.loading}>
          <Loader2 className="spin" aria-hidden /> Reading history…
        </div>
      ) : view.all.replies === 0 ? (
        <EmptyState compact title="No usage yet" description="Nothing in this period. Agents' replies show up here once Claude Code, Codex or Gemini CLI answer on this computer." />
      ) : (
        <>
          <div className={styles.tiles}>
            <Tile label="Total tokens" value={totalTokens(view.all)} note={`${exact.format(view.all.replies)} replies · ${exact.format(report!.sessions)} conversations`} />
            <Tile label="Input" value={view.all.input} />
            <Tile label="Output" value={view.all.output} />
            <Tile label="From cache" value={view.all.cacheRead} note={`${Math.round(cacheShare(view.all) * 100)}% of input`} />
          </div>
          {view.daily.length > 1 && (
            <figure className={styles.chart}>
              <figcaption className={styles.caption}>Tokens per day</figcaption>
              <div className={styles.plot} role="list" aria-label="Tokens per day">
                {view.daily.map((d) => (
                  <div key={d.day} role="listitem" tabIndex={0} className={styles.column} aria-label={`${d.day}: ${exact.format(d.total)} tokens`} data-tip={`${d.day} · ${compactTokens(d.total)}`}>
                    <span className={styles.barFill} style={{ '--share': d.total / view.peak } as CSSProperties} />
                  </div>
                ))}
              </div>
              <div className={styles.axis} aria-hidden>
                <span>{view.daily[0]!.day}</span>
                <span>peak {compactTokens(view.peak)}</span>
                <span>{view.daily.at(-1)!.day}</span>
              </div>
            </figure>
          )}
          <UsageTable title="By CLI" first="CLI" groups={view.byCli} label={(g) => name(g.key)} />
          <UsageTable
            title="By model"
            first="Model"
            groups={view.byModel}
            label={(g) => {
              const { cliId, model } = splitModelKey(g.key)
              return `${model} · ${name(cliId)}`
            }}
          />
        </>
      )}
    </SettingsPage>
  )
}

function Tile({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className={styles.tile} title={exact.format(value)}>
      <span className={styles.tileLabel}>{label}</span>
      <span className={styles.tileValue}>{compactTokens(value)}</span>
      {note && <span className={styles.tileNote}>{note}</span>}
    </div>
  )
}

function UsageTable({ title, first, groups, label }: { title: string; first: string; groups: UsageGroup[]; label: (g: UsageGroup) => string }) {
  return (
    <section className={styles.group} aria-label={title}>
      <h3 className={styles.groupTitle}>{title}</h3>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">{first}</th>
            <th scope="col">Input</th>
            <th scope="col">Output</th>
            <th scope="col">Cache read</th>
            <th scope="col">Cache write</th>
            <th scope="col">Replies</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.key}>
              <th scope="row">{label(g)}</th>
              <td title={exact.format(g.input)}>{compactTokens(g.input)}</td>
              <td title={exact.format(g.output)}>{compactTokens(g.output)}</td>
              <td title={exact.format(g.cacheRead)}>{compactTokens(g.cacheRead)}</td>
              <td title={exact.format(g.cacheWrite)}>{compactTokens(g.cacheWrite)}</td>
              <td>{exact.format(g.replies)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
