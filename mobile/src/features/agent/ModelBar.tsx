import { useMemo, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Cpu, Gauge } from 'lucide-react-native'
import type { ChatModel } from '@shared/domain/chat'
import { useAction, useCall, useConnection, type Response } from '@/core/api'
import { space, useTheme } from '@/core/theme'
import { Button, ListRow, Loading, Sheet, Text, TextField } from '@/core/ui'

/** Long lists (OpenCode lists hundreds) show this many at a time; search narrows them. */
const MAX_VISIBLE = 150

const title = (effort: string): string => effort[0]!.toUpperCase() + effort.slice(1)

/**
 * A chat-view agent's model and reasoning effort, as on the computer's composer. Effort shows only
 * for a model that has levels. Changes apply from the next message (chat.setModel).
 */
export function ModelBar({ chatId }: { chatId: string }) {
  const { colors } = useTheme()
  const { computer } = useConnection()
  const queryClient = useQueryClient()
  const chat = useCall('chat.get', { chatId })
  const cliId = chat.data?.cliId
  const catalog = useCall('chat.catalog', { cliId: cliId ?? '' }, { enabled: Boolean(cliId), staleTime: 10 * 60_000 })
  const set = useAction('chat.setModel')
  const [sheet, setSheet] = useState<'model' | 'effort' | null>(null)
  const [query, setQuery] = useState('')

  const models = useMemo(() => catalog.data?.models ?? [], [catalog.data])
  const value = chat.data?.model ?? ''
  const model: ChatModel | undefined = models.find((m) => m.id === value)
  const efforts = model?.efforts ?? []
  const effort = chat.data?.effort
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (q ? models.filter((m) => `${m.label} ${m.id} ${m.group ?? ''}`.toLowerCase().includes(q)) : models).slice(0, MAX_VISIBLE)
  }, [models, query])

  if (!chat.data || !cliId) return null

  const choose = (next: { model: string; effort: string }): void => {
    setSheet(null)
    set.mutate(
      { chatId, ...next },
      {
        onSuccess: (saved) =>
          queryClient.setQueryData<Response<'chat.get'>>([computer?.id, 'chat.get', { chatId }], (current) =>
            current ? { ...current, model: saved.model, effort: saved.effort } : current
          )
      }
    )
  }

  const check = (on: boolean) => (on ? <Check size={18} color={colors.accent} /> : null)

  return (
    <>
      <View style={styles.row}>
        <Button
          size="sm"
          icon={Cpu}
          label={catalog.isLoading ? 'Loading models…' : (model?.label ?? 'Default model')}
          loading={set.isPending}
          onPress={() => setSheet('model')}
        />
        {efforts.length > 0 ? (
          <Button size="sm" icon={Gauge} label={title(effort || model?.defaultEffort || 'effort')} onPress={() => setSheet('effort')} />
        ) : null}
      </View>

      <Sheet open={sheet === 'model'} title="Model" onClose={() => setSheet(null)}>
        {models.length > 12 ? <TextField placeholder={`Search ${models.length} models`} value={query} onChangeText={setQuery} accessibilityLabel="Search models" /> : null}
        {catalog.data?.error ? (
          <Text variant="caption" tone="muted">
            {catalog.data.error} The default model still works.
          </Text>
        ) : null}
        {catalog.isLoading ? (
          <Loading />
        ) : (
          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
            {shown.map((m) => (
              <ListRow
                key={m.id || 'default'}
                title={m.label}
                subtitle={[m.group, m.description ?? m.id].filter(Boolean).join(' · ') || undefined}
                trailing={check(m.id === value)}
                onPress={() => choose({ model: m.id, effort: m.efforts?.includes(effort ?? '') ? effort! : '' })}
              />
            ))}
            {shown.length === 0 ? (
              <Text tone="muted" style={styles.note}>
                No models match “{query}”.
              </Text>
            ) : null}
          </ScrollView>
        )}
      </Sheet>

      <Sheet open={sheet === 'effort'} title="Reasoning effort" onClose={() => setSheet(null)}>
        <ListRow
          title={`Default${model?.defaultEffort ? ` (${model.defaultEffort})` : ''}`}
          trailing={check(!effort)}
          onPress={() => choose({ model: value, effort: '' })}
        />
        {efforts.map((e) => (
          <ListRow key={e} title={title(e)} trailing={check(effort === e)} onPress={() => choose({ model: value, effort: e })} />
        ))}
      </Sheet>
    </>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3], paddingHorizontal: space[5] },
  list: { maxHeight: 420 },
  note: { padding: space[5] }
})
