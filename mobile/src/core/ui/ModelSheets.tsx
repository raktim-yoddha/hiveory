import { useMemo, useState } from 'react'
import { ScrollView, StyleSheet } from 'react-native'
import { Check } from 'lucide-react-native'
import type { ChatModel } from '@shared/domain/chat'
import { space, useTheme } from '../theme'
import { ListRow } from './ListRow'
import { Loading } from './Loading'
import { Sheet } from './Sheet'
import { Text } from './Text'
import { TextField } from './TextField'

/** Long lists (OpenCode lists hundreds) show this many at a time; search narrows them. */
const MAX_VISIBLE = 150

export const effortLabel = (effort: string): string => effort[0]!.toUpperCase() + effort.slice(1)

const Tick = ({ on }: { on: boolean }) => {
  const { colors } = useTheme()
  return on ? <Check size={18} color={colors.accent} /> : null
}

/** Picks a chat CLI's model: grouped, searchable when long, the current one ticked. */
export function ModelSheet({
  open,
  onClose,
  models,
  loading,
  error,
  value,
  onChoose
}: {
  open: boolean
  onClose: () => void
  models: ChatModel[]
  loading?: boolean
  error?: string
  value: string
  onChoose: (model: ChatModel) => void
}) {
  const [query, setQuery] = useState('')
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (q ? models.filter((m) => `${m.label} ${m.id} ${m.group ?? ''}`.toLowerCase().includes(q)) : models).slice(0, MAX_VISIBLE)
  }, [models, query])
  return (
    <Sheet open={open} title="Model" onClose={onClose}>
      {models.length > 12 ? <TextField placeholder={`Search ${models.length} models`} value={query} onChangeText={setQuery} accessibilityLabel="Search models" /> : null}
      {error ? (
        <Text variant="caption" tone="muted">
          {error} The default model still works.
        </Text>
      ) : null}
      {loading ? (
        <Loading />
      ) : (
        <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
          {shown.map((m) => (
            <ListRow
              key={m.id || 'default'}
              title={m.label}
              subtitle={[m.group, m.description ?? m.id].filter(Boolean).join(' · ') || undefined}
              trailing={<Tick on={m.id === value} />}
              onPress={() => onChoose(m)}
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
  )
}

/** Picks a model's reasoning effort; '' is the model's default. */
export function EffortSheet({
  open,
  onClose,
  efforts,
  defaultEffort,
  value,
  onChoose
}: {
  open: boolean
  onClose: () => void
  efforts: string[]
  defaultEffort?: string
  value: string
  onChoose: (effort: string) => void
}) {
  return (
    <Sheet open={open} title="Reasoning effort" onClose={onClose}>
      <ListRow title={`Default${defaultEffort ? ` (${defaultEffort})` : ''}`} trailing={<Tick on={!value} />} onPress={() => onChoose('')} />
      {efforts.map((e) => (
        <ListRow key={e} title={effortLabel(e)} trailing={<Tick on={value === e} />} onPress={() => onChoose(e)} />
      ))}
    </Sheet>
  )
}

const styles = StyleSheet.create({
  list: { maxHeight: 420 },
  note: { padding: space[5] }
})
