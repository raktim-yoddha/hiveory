import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useQueryClient } from '@tanstack/react-query'
import { Cpu, Gauge } from 'lucide-react-native'
import type { ChatModel } from '@shared/domain/chat'
import { useAction, useCall, useConnection, type Response } from '@/core/api'
import { space } from '@/core/theme'
import { Button, EffortSheet, effortLabel, ModelSheet } from '@/core/ui'

/**
 * A chat-view agent's model and reasoning effort, as on the computer's composer. Effort shows only
 * for a model that has levels. Changes apply from the next message (chat.setModel).
 */
export function ModelBar({ chatId }: { chatId: string }) {
  const { computer } = useConnection()
  const queryClient = useQueryClient()
  const chat = useCall('chat.get', { chatId })
  const cliId = chat.data?.cliId
  const catalog = useCall('chat.catalog', { cliId: cliId ?? '' }, { enabled: Boolean(cliId), staleTime: 10 * 60_000 })
  const set = useAction('chat.setModel')
  const [sheet, setSheet] = useState<'model' | 'effort' | null>(null)

  if (!chat.data || !cliId) return null
  const models = catalog.data?.models ?? []
  const value = chat.data.model ?? ''
  const model: ChatModel | undefined = models.find((m) => m.id === value)
  const efforts = model?.efforts ?? []
  const effort = chat.data.effort ?? ''

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
        {efforts.length > 0 ? <Button size="sm" icon={Gauge} label={effortLabel(effort || model?.defaultEffort || 'effort')} onPress={() => setSheet('effort')} /> : null}
      </View>
      <ModelSheet
        open={sheet === 'model'}
        onClose={() => setSheet(null)}
        models={models}
        loading={catalog.isLoading}
        error={catalog.data?.error}
        value={value}
        onChoose={(m) => choose({ model: m.id, effort: m.efforts?.includes(effort) ? effort : '' })}
      />
      <EffortSheet
        open={sheet === 'effort'}
        onClose={() => setSheet(null)}
        efforts={efforts}
        defaultEffort={model?.defaultEffort}
        value={effort}
        onChoose={(e) => choose({ model: value, effort: e })}
      />
    </>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3], paddingHorizontal: space[5] }
})
