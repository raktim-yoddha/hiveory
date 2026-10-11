import { useState } from 'react'
import { router } from 'expo-router'
import { Bot, Crown } from 'lucide-react-native'
import { useCall } from '@/core/api'
import { routes } from '@/core/routes'
import { useTheme } from '@/core/theme'
import { EmptyState, ListRow, Loading, Screen, Section, StatusDot } from '@/core/ui'

/** Bots on the phone (ADR 0039): every bot, Chiefs first, with whether it is working; tap for its threads. */
export function BotsScreen() {
  const { colors } = useTheme()
  const bots = useCall('bots.list', undefined)
  const [refreshing, setRefreshing] = useState(false)

  if (bots.isLoading) return <Loading label="Loading bots…" />
  const list = [...(bots.data ?? [])].sort((a, b) => Number(b.chief) - Number(a.chief) || a.name.localeCompare(b.name))
  if (!list.length) return <EmptyState icon={Bot} title="No bots yet" body="Create bots in Hiveory on your computer; they show up here to talk to." />

  return (
    <Screen
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true)
        void bots.refetch().finally(() => setRefreshing(false))
      }}
    >
      <Section>
        {list.map((b) => (
          <ListRow
            key={b.id}
            title={b.name}
            subtitle={b.blurb ?? `${b.threads} ${b.threads === 1 ? 'thread' : 'threads'}`}
            label={`${b.name}${b.chief ? ', Chief of Staff' : ''}${b.running ? ', working' : ''}`}
            leading={b.chief ? <Crown size={18} color={colors.brand} /> : <Bot size={18} color={colors.textMuted} />}
            trailing={b.running ? <StatusDot status="working" /> : null}
            onPress={() => router.push(routes.bot(b.id))}
          />
        ))}
      </Section>
    </Screen>
  )
}
