import { useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { router } from 'expo-router'
import { FolderOpen, Server } from 'lucide-react-native'
import type { Project } from '@shared/domain/project'
import { useCall, useCalls } from '@/core/api'
import { routes } from '@/core/routes'
import { space, useTheme } from '@/core/theme'
import { EmptyState, ListRow, Loading, Screen, Section, StatusDot, Text } from '@/core/ui'

/** Most recently worked on first, like the desktop sidebar. */
const byWork = (a: Project, b: Project): number => (b.lastActiveAt ?? b.createdAt).localeCompare(a.lastActiveAt ?? a.createdAt)

/** Every project on the computer, with how many agents need the user or are working in each. */
export function ProjectsScreen() {
  const { colors } = useTheme()
  const projects = useCall('projects.list', undefined)
  const list = useMemo(() => [...(projects.data ?? [])].sort(byWork), [projects.data])
  const boards = useCalls(
    'kanban.board',
    list.map((p) => ({ projectId: p.id }))
  )
  const [refreshing, setRefreshing] = useState(false)

  if (projects.isLoading) return <Loading label="Loading projects…" />
  if (!list.length) return <EmptyState icon={FolderOpen} title="No projects yet" body="Add a project in Hiveory on your computer; it appears here right away." />

  return (
    <Screen
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true)
        void projects.refetch().finally(() => setRefreshing(false))
      }}
    >
      <Section>
        {list.map((p, i) => {
          const board = boards[i]?.data
          const waiting = board?.['waiting-for-you'].length ?? 0
          const working = board?.working.length ?? 0
          return (
            <ListRow
              key={p.id}
              title={p.name}
              subtitle={p.host ? `On ${p.host.destination}` : p.path}
              label={`${p.name}${waiting ? `, ${waiting} need you` : ''}${working ? `, ${working} working` : ''}`}
              leading={p.host ? <Server size={18} color={colors.brand} /> : <FolderOpen size={18} color={colors.textMuted} />}
              trailing={
                <View style={styles.counts}>
                  {waiting ? (
                    <View style={styles.count}>
                      <StatusDot status="waiting-for-you" />
                      <Text variant="label" tone="waiting">
                        {waiting}
                      </Text>
                    </View>
                  ) : null}
                  {working ? (
                    <View style={styles.count}>
                      <StatusDot status="working" />
                      <Text variant="label" tone="working">
                        {working}
                      </Text>
                    </View>
                  ) : null}
                </View>
              }
              onPress={() => router.push(routes.project(p.id))}
            />
          )
        })}
      </Section>
    </Screen>
  )
}

const styles = StyleSheet.create({
  counts: { flexDirection: 'row', gap: space[5] },
  count: { flexDirection: 'row', alignItems: 'center', gap: space[2] }
})
