import { useState } from 'react'
import { Stack } from 'expo-router'
import { MoreVertical, Plus, Users } from 'lucide-react-native'
import type { Team } from '@shared/domain/bot'
import { MAX_TEAM_NAME } from '@shared/domain/bot'
import { useAction, useCall } from '@/core/api'
import { choose, confirm, EmptyState, IconButton, ListRow, Loading, PromptSheet, Screen, Section } from '@/core/ui'

/** Bot teams on the phone (ADR 0053): each with how many bots it has; make, rename or delete one. */
export function TeamsScreen() {
  const teams = useCall('teams.list', undefined)
  const bots = useCall('bots.list', undefined)
  const create = useAction('teams.create')
  const rename = useAction('teams.rename')
  const remove = useAction('teams.delete')
  const [asking, setAsking] = useState<{ team?: Team } | null>(null)

  if (teams.isLoading) return <Loading />
  const count = (id: string): number => (bots.data ?? []).filter((b) => b.teamId === id).length

  return (
    <>
      <Stack.Screen options={{ title: 'Teams', headerRight: () => <IconButton label="New team" icon={Plus} onPress={() => setAsking({})} /> }} />
      <Screen>
        {teams.data?.length ? (
          <Section>
            {teams.data.map((t) => (
              <ListRow
                key={t.id}
                title={t.name}
                subtitle={`${count(t.id)} ${count(t.id) === 1 ? 'bot' : 'bots'}`}
                leading={<Users size={18} />}
                trailing={
                  <IconButton
                    label={`More for ${t.name}`}
                    icon={MoreVertical}
                    onPress={() =>
                      choose(t.name, [
                        { label: 'Rename', onPress: () => setAsking({ team: t }) },
                        { label: 'Delete', destructive: true, onPress: () => confirm(`Delete ${t.name}?`, 'Its bots move to General.', 'Delete', () => remove.mutate({ teamId: t.id })) }
                      ])
                    }
                  />
                }
              />
            ))}
          </Section>
        ) : (
          <EmptyState icon={Users} title="No teams yet" body="Group bots into teams, each with its Chief of Staff." />
        )}
      </Screen>
      <PromptSheet
        open={asking !== null}
        title={asking?.team ? `Rename ${asking.team.name}` : 'New team'}
        label="Team name"
        initial={asking?.team?.name ?? ''}
        action={asking?.team ? 'Rename' : 'Create'}
        maxLength={MAX_TEAM_NAME}
        busy={create.isPending || rename.isPending}
        onSubmit={(name) => {
          const done = { onSuccess: () => setAsking(null) }
          if (asking?.team) rename.mutate({ teamId: asking.team.id, name }, done)
          else create.mutate({ name }, done)
        }}
        onClose={() => setAsking(null)}
      />
    </>
  )
}
