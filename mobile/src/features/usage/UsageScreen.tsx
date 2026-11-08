import { useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { BarChart3 } from 'lucide-react-native'
import { cacheShare, compactTokens, groupUsage, splitModelKey, totalTokens, USAGE_DAYS } from '@shared/domain/usage'
import { useCall } from '@/core/api'
import { radius, space, useTheme } from '@/core/theme'
import { Card, EmptyState, ListRow, Loading, Screen, Section, Segmented, Text } from '@/core/ui'

type Days = `${(typeof USAGE_DAYS)[number]}`
const LABEL: Record<Days, string> = { '1': 'Today', '7': '7 days', '30': '30 days', '90': '90 days' }

/**
 * Tokens the computer's agents used (ADR 0060), as its Settings › Usage shows them: totals, a bar per
 * day, and each CLI and model. Counts only, read from the CLIs' own history on that computer.
 */
export function UsageScreen() {
  const { colors } = useTheme()
  const [days, setDays] = useState<Days>('7')
  const usage = useCall('usage.report', { days: Number(days) })
  const clis = useCall('clis.list', undefined, { staleTime: 10 * 60_000 })
  const [refreshing, setRefreshing] = useState(false)
  const name = (cliId: string): string => clis.data?.find((c) => c.id === cliId)?.displayName ?? cliId

  const view = useMemo(() => {
    const rows = usage.data?.rows ?? []
    const byCli = groupUsage(rows, 'cliId')
    const all = byCli.reduce((sum, g) => ({ input: sum.input + g.input, output: sum.output + g.output, cacheRead: sum.cacheRead + g.cacheRead, cacheWrite: sum.cacheWrite + g.cacheWrite, replies: sum.replies + g.replies }), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, replies: 0 })
    const daily = groupUsage(rows, 'day').map((g) => ({ day: g.key, total: totalTokens(g) }))
    return { all, byCli, byModel: groupUsage(rows, 'model'), daily, peak: Math.max(1, ...daily.map((d) => d.total)) }
  }, [usage.data])

  return (
    <Screen
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true)
        void usage.refetch().finally(() => setRefreshing(false))
      }}
    >
      <Segmented label="Period" value={days} onChange={setDays} options={USAGE_DAYS.map((d) => ({ value: `${d}` as Days, label: LABEL[`${d}`] }))} />
      {usage.isLoading ? (
        <Loading label="Reading history…" />
      ) : view.all.replies === 0 ? (
        <EmptyState icon={BarChart3} title="No usage yet" body="Replies from Claude Code, Codex or Gemini CLI on the computer show up here." />
      ) : (
        <>
          <View style={styles.tiles}>
            <Tile label="Total" value={compactTokens(totalTokens(view.all))} note={`${view.all.replies} replies`} />
            <Tile label="Output" value={compactTokens(view.all.output)} />
            <Tile label="From cache" value={`${Math.round(cacheShare(view.all) * 100)}%`} note="of input" />
          </View>
          {view.daily.length > 1 ? (
            <Card>
              <Text variant="overline" tone="muted">
                Tokens per day
              </Text>
              <View style={styles.plot} accessibilityLabel={`Tokens per day, peak ${compactTokens(view.peak)}`}>
                {view.daily.map((d) => (
                  <View key={d.day} accessibilityLabel={`${d.day}: ${compactTokens(d.total)}`} style={[styles.bar, { height: `${Math.max(1, (d.total / view.peak) * 100)}%`, backgroundColor: colors.textSecondary }]} />
                ))}
              </View>
            </Card>
          ) : null}
          <Section title="By CLI">
            {view.byCli.map((g) => (
              <ListRow key={g.key} title={name(g.key)} subtitle={`${compactTokens(g.input)} in · ${compactTokens(g.output)} out · ${compactTokens(g.cacheRead)} cached`} trailing={<Text tone="secondary">{compactTokens(totalTokens(g))}</Text>} />
            ))}
          </Section>
          <Section title="By model">
            {view.byModel.map((g) => {
              const { cliId, model } = splitModelKey(g.key)
              return <ListRow key={g.key} title={model} subtitle={`${name(cliId)} · ${g.replies} replies`} trailing={<Text tone="secondary">{compactTokens(totalTokens(g))}</Text>} />
            })}
          </Section>
        </>
      )}
    </Screen>
  )
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  const { colors } = useTheme()
  return (
    <View style={[styles.tile, { backgroundColor: colors.surface }]}>
      <Text variant="overline" tone="muted">
        {label}
      </Text>
      <Text variant="title">{value}</Text>
      {note ? (
        <Text variant="caption" tone="muted">
          {note}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', gap: space[4] },
  tile: { flex: 1, gap: space[1], padding: space[6], borderRadius: radius.md },
  plot: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 96, marginTop: space[4] },
  bar: { flex: 1, borderTopLeftRadius: 3, borderTopRightRadius: 3, opacity: 0.8 }
})
