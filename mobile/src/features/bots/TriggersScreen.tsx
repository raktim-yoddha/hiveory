import { useState } from 'react'
import { Stack } from 'expo-router'
import { MoreVertical, Zap } from 'lucide-react-native'
import type { Trigger } from '@shared/domain/trigger'
import { useAction, useCall } from '@/core/api'
import { Card, choose, confirm, EmptyState, IconButton, ListRow, Loading, PromptSheet, Screen, Section, SwitchRow, Text } from '@/core/ui'

/**
 * Triggers on the phone (ADR 0053): the link that brings outside events in, and each trigger with
 * its bot, on or off; rename it, change what the bot does with an event, or delete it. A new trigger
 * picks an app account and its settings, so it is made on the computer.
 */
export function TriggersScreen() {
  const link = useCall('triggers.status', undefined)
  const triggers = useCall('triggers.list', undefined)
  const bots = useCall('bots.list', undefined)
  const enable = useAction('triggers.enableLink')
  const disable = useAction('triggers.disableLink')
  const update = useAction('triggers.update')
  const remove = useAction('triggers.delete')
  const [editing, setEditing] = useState<{ trigger: Trigger; field: 'name' | 'prompt' } | null>(null)

  if (triggers.isLoading || link.isLoading) return <Loading />
  const on = link.data?.state === 'on'
  const nameOf = (id: string): string => bots.data?.find((b) => b.id === id)?.name ?? 'A bot'

  return (
    <>
      <Stack.Screen options={{ title: 'Triggers' }} />
      <Screen>
        <Card>
          <SwitchRow
            label="Receive events"
            hint={link.data?.detail ?? (on ? 'Outside events reach your bots.' : 'Off: no trigger fires.')}
            value={on}
            disabled={enable.isPending || disable.isPending}
            onChange={(next) => (next ? enable.mutate({ takeOver: Boolean(link.data?.conflict) }) : disable.mutate(undefined))}
          />
          {link.data?.conflict ? <Text tone="waiting">{link.data.conflict}</Text> : null}
        </Card>
        {triggers.data?.length ? (
          <Section>
            {triggers.data.map((t) => (
              <ListRow
                key={t.id}
                title={t.name}
                subtitle={[nameOf(t.botId), t.triggerName, t.enabled ? null : 'off'].filter(Boolean).join(' · ')}
                trailing={
                  <IconButton
                    label={`More for ${t.name}`}
                    icon={MoreVertical}
                    onPress={() =>
                      choose(t.name, [
                        { label: t.enabled ? 'Turn off' : 'Turn on', onPress: () => update.mutate({ triggerId: t.id, enabled: !t.enabled }) },
                        { label: 'Rename', onPress: () => setEditing({ trigger: t, field: 'name' }) },
                        { label: 'What the bot does', onPress: () => setEditing({ trigger: t, field: 'prompt' }) },
                        { label: 'Delete', destructive: true, onPress: () => confirm(`Delete ${t.name}?`, 'Its events stop reaching the bot.', 'Delete', () => remove.mutate({ triggerId: t.id })) }
                      ])
                    }
                  />
                }
              />
            ))}
          </Section>
        ) : (
          <EmptyState icon={Zap} title="No triggers yet" body="Make one on the computer: a bot then acts when something happens in a connected app." />
        )}
      </Screen>
      <PromptSheet
        open={editing !== null}
        title={editing?.field === 'name' ? 'Rename trigger' : 'What the bot does with each event'}
        label={editing?.field === 'name' ? 'Name' : 'Instructions'}
        initial={editing ? editing.trigger[editing.field] : ''}
        multiline={editing?.field === 'prompt'}
        action="Save"
        busy={update.isPending}
        onSubmit={(value) => editing && update.mutate({ triggerId: editing.trigger.id, [editing.field]: value }, { onSuccess: () => setEditing(null) })}
        onClose={() => setEditing(null)}
      />
    </>
  )
}
