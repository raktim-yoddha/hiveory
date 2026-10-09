import { useState } from 'react'
import { Linking } from 'react-native'
import { Stack } from 'expo-router'
import { ExternalLink, GitBranch, GitPullRequest, GitPullRequestDraft } from 'lucide-react-native'
import { useAction, useCall } from '@/core/api'
import { useNotices } from '@/core/notices'
import { useTheme } from '@/core/theme'
import { Button, EmptyState, ListRow, Loading, Screen, Section } from '@/core/ui'

/**
 * A Workspace's pull requests on the phone (ADR 0037), as on the computer's tab: each worktree
 * branch with its pull request (or a button to open one), then every open pull request.
 */
export function PullRequestsScreen({ projectId }: { projectId: string }) {
  const { colors } = useTheme()
  const status = useCall('github.status', { projectId })
  const prs = useCall('github.pullRequests', { projectId }, { enabled: Boolean(status.data?.available) })
  const workspaces = useCall('workspaces.list', { projectId })
  const create = useAction('github.createPullRequest')
  const [creating, setCreating] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  if (status.isLoading) return <Loading label="Checking GitHub…" />
  if (!status.data?.available) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Pull requests' }} />
        <EmptyState
          icon={GitPullRequest}
          title="Pull requests need the GitHub CLI"
          body={status.data?.reason ?? 'On the computer: install gh and run "gh auth login".'}
          action={<Button label="Check again" onPress={() => void status.refetch()} />}
        />
      </Screen>
    )
  }

  const branches = (workspaces.data ?? []).filter((w) => w.kind === 'isolated' && w.git?.branch)
  const open = (url: string): void => void Linking.openURL(url)

  return (
    <>
      <Stack.Screen options={{ title: 'Pull requests' }} />
      <Screen
        refreshing={refreshing}
        onRefresh={() => {
          setRefreshing(true)
          void Promise.all([prs.refetch(), workspaces.refetch()]).finally(() => setRefreshing(false))
        }}
      >
        <Section title="Worktree branches">
          {branches.length ? (
            branches.map((w) => {
              const pr = prs.data?.find((p) => p.branch === w.git?.branch)
              return (
                <ListRow
                  key={w.id}
                  title={w.name}
                  subtitle={pr ? `#${pr.number} · ${w.git?.branch}` : w.git?.branch}
                  leading={<GitBranch size={18} color={colors.brand} />}
                  trailing={
                    pr ? null : (
                      <Button
                        label="Create PR"
                        size="sm"
                        icon={GitPullRequest}
                        loading={create.isPending && creating === w.id}
                        onPress={() => {
                          setCreating(w.id)
                          create.mutate(
                            { workspaceId: w.id },
                            {
                              onSuccess: ({ url }) => {
                                useNotices.getState().push({ level: 'info', message: 'Pull request created.' })
                                void prs.refetch()
                                open(url)
                              }
                            }
                          )
                        }}
                      />
                    )
                  }
                  onPress={pr ? () => open(pr.url) : undefined}
                />
              )
            })
          ) : (
            <EmptyState compact icon={GitBranch} title="No worktree branches" body="Create a worktree to open pull requests from its branch." />
          )}
        </Section>
        <Section title={`Open pull requests · ${prs.data?.length ?? 0}`}>
          {prs.isLoading ? <Loading /> : null}
          {prs.data?.map((pr) => (
            <ListRow
              key={pr.number}
              title={pr.title}
              subtitle={[`#${pr.number}`, pr.branch, pr.author, pr.reviewDecision?.toLowerCase().replace('_', ' ')].filter(Boolean).join(' · ')}
              leading={pr.draft ? <GitPullRequestDraft size={18} color={colors.textMuted} /> : <GitPullRequest size={18} color={colors.working} />}
              trailing={<ExternalLink size={16} color={colors.textFaint} />}
              label={`${pr.title}, pull request ${pr.number}${pr.draft ? ', draft' : ''}`}
              onPress={() => open(pr.url)}
            />
          ))}
          {prs.data && !prs.data.length ? <EmptyState compact icon={GitPullRequest} title="No open pull requests" /> : null}
        </Section>
      </Screen>
    </>
  )
}
