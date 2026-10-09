import { useState, type ComponentProps } from 'react'
import { ScrollView, StyleSheet, Switch, View } from 'react-native'
import { Stack } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import { Check, GitBranch } from 'lucide-react-native'
import { DEFAULT_BRANCH_PREFIX, type AgentView, type ChatChoice } from '@shared/domain/project'
import type { ChatModel } from '@shared/domain/chat'
import { useAction, useCall, useCliIcons, useConnection, type Request, type Response } from '@/core/api'
import { space, useTheme } from '@/core/theme'
import { Card, CliLogo, EffortSheet, effortLabel, ListRow, Loading, ModelSheet, Screen, Section, Segmented, Sheet, Text, TextField } from '@/core/ui'

type Settings = NonNullable<Request<'projects.update'>['settings']>

/**
 * A Workspace's own settings on the phone (ADR 0037), the same ones as the computer's Settings tab:
 * its name, how new agents open, the model each chat CLI starts with, how new worktrees are
 * branched, and whether its agents announce themselves.
 */
export function ProjectSettingsScreen({ projectId }: { projectId: string }) {
  const { colors } = useTheme()
  const projects = useCall('projects.list', undefined)
  const project = projects.data?.find((p) => p.id === projectId)
  const git = useCall('git.info', { projectId }, { enabled: Boolean(project?.repositoryRoot) })
  const action = useAction('projects.update')
  const { computer } = useConnection()
  const queryClient = useQueryClient()
  // The saved Workspace replaces the cached one at once (the computer's live event refreshes the rest).
  const save = {
    mutate: (payload: Request<'projects.update'>) =>
      action.mutate(payload, {
        onSuccess: (saved) =>
          queryClient.setQueryData<Response<'projects.list'>>([computer?.id, 'projects.list', undefined], (list) => list?.map((p) => (p.id === saved.id ? saved : p)))
      })
  }
  const [picking, setPicking] = useState<'base' | null>(null)

  if (projects.isLoading) return <Loading />
  if (!project) return <Text tone="muted">This workspace is gone.</Text>
  const s = project.settings ?? {}
  const remote = Boolean(project.host)
  const update = (settings: Settings): void => save.mutate({ projectId, settings })

  return (
    <>
      <Stack.Screen options={{ title: 'Workspace settings' }} />
      <Screen>
        <Section title="General">
          <CommitField key={project.name} label="Name" value={project.name} maxLength={120} onCommit={(name) => name && save.mutate({ projectId, name })} />
          <Text variant="caption" tone="muted" selectable>
            {project.path}
            {project.repositoryRoot ? '' : ' · not a Git repository'}
          </Text>
        </Section>

        <Section title="New agents open as">
          {remote ? (
            <Text tone="muted">Agents on an SSH host always open in their terminal.</Text>
          ) : (
            <>
              <Segmented<'' | AgentView>
                label="New agents open as"
                value={s.agentView ?? ''}
                onChange={(v) => update({ agentView: v === '' ? null : v })}
                options={[
                  { value: '', label: 'Per worktree' },
                  { value: 'terminal', label: 'Terminal' },
                  { value: 'chat', label: 'Chat' }
                ]}
              />
              <Text variant="caption" tone="muted">
                Used by Open an agent here and by the computer&apos;s “+” menu, in every worktree. You can still pick the other one each time.
              </Text>
            </>
          )}
        </Section>

        <Section title="Announce agents">
          <Card>
            <View style={styles.switchRow}>
              <Text style={styles.flex}>Updates and phone alerts when an agent here finishes or needs you</Text>
              <Switch
                accessibilityLabel="Announce agents in this workspace"
                value={s.alerts !== false}
                trackColor={{ true: colors.brand, false: colors.surfaceActive }}
                thumbColor={colors.text}
                onValueChange={(on) => update({ alerts: on ? null : false })}
              />
            </View>
          </Card>
        </Section>

        {remote ? null : <ChatDefaults projectId={projectId} defaults={s.chatDefaults ?? {}} onSave={(chatDefaults) => update({ chatDefaults })} />}

        {project.repositoryRoot ? (
          <Section title="New worktrees">
            <CommitField
              key={s.branchPrefix ?? DEFAULT_BRANCH_PREFIX}
              label="Branch prefix"
              hint={`New branches are named like ${s.branchPrefix ?? DEFAULT_BRANCH_PREFIX}fix-login.`}
              value={s.branchPrefix ?? DEFAULT_BRANCH_PREFIX}
              autoCapitalize="none"
              maxLength={40}
              mono
              onCommit={(next) => update({ branchPrefix: next === DEFAULT_BRANCH_PREFIX ? null : next })}
            />
            <ListRow
              title="Start from"
              subtitle={s.baseRef ?? `Repository default${git.data?.defaultBranch ? ` (${git.data.defaultBranch})` : ''}`}
              leading={<GitBranch size={18} color={colors.textMuted} />}
              onPress={() => setPicking('base')}
            />
          </Section>
        ) : null}
      </Screen>

      <Sheet open={picking === 'base'} title="New worktrees start from" onClose={() => setPicking(null)}>
        <ScrollView style={styles.list}>
          <ListRow
            title={`Repository default${git.data?.defaultBranch ? ` (${git.data.defaultBranch})` : ''}`}
            trailing={!s.baseRef ? <Check size={18} color={colors.accent} /> : null}
            onPress={() => (setPicking(null), update({ baseRef: null }))}
          />
          {(git.data?.branches ?? []).map((b) => (
            <ListRow key={b} title={b} trailing={s.baseRef === b ? <Check size={18} color={colors.accent} /> : null} onPress={() => (setPicking(null), update({ baseRef: b }))} />
          ))}
        </ScrollView>
      </Sheet>
    </>
  )
}

/** A text setting saved when the user finishes editing it (never on every keystroke). Keyed by its value, so a change from the computer shows. */
function CommitField({ value, onCommit, ...rest }: Omit<ComponentProps<typeof TextField>, 'value' | 'onChangeText'> & { value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value)
  return (
    <TextField
      {...rest}
      value={draft}
      onChangeText={setDraft}
      returnKeyType="done"
      onEndEditing={() => {
        const next = draft.trim()
        if (next !== value) onCommit(next)
      }}
    />
  )
}

/** The model and effort each chat CLI starts with here: tap a CLI, pick a model, then its effort. */
function ChatDefaults({ projectId, defaults, onSave }: { projectId: string; defaults: Record<string, ChatChoice>; onSave: (next: Record<string, ChatChoice> | null) => void }) {
  const chatClis = useCall('chat.clis', undefined)
  const clis = useCall('clis.list', { projectId })
  const icons = useCliIcons(projectId)
  const [cliId, setCliId] = useState<string | null>(null)
  const [step, setStep] = useState<'model' | 'effort' | null>(null)
  const [model, setModel] = useState<ChatModel | null>(null)
  const catalog = useCall('chat.catalog', { cliId: cliId ?? '' }, { enabled: Boolean(cliId), staleTime: 10 * 60_000 })

  const store = (id: string, choice: ChatChoice): void => {
    const next = { ...defaults, [id]: choice }
    if (!choice.model && !choice.effort) delete next[id]
    onSave(Object.keys(next).length ? next : null)
  }
  const close = (): void => {
    setStep(null)
    setCliId(null)
  }

  if (!chatClis.data?.length) return null
  return (
    <Section title="Chat agents start with">
      {chatClis.data.map((id) => {
        const choice = defaults[id]
        return (
          <ListRow
            key={id}
            title={clis.data?.find((c) => c.id === id)?.displayName ?? id}
            subtitle={choice ? [choice.model || 'Default model', choice.effort && effortLabel(choice.effort)].filter(Boolean).join(' · ') : 'Default model'}
            leading={<CliLogo icon={icons.get(id)} size={24} />}
            onPress={() => {
              setCliId(id)
              setStep('model')
            }}
          />
        )
      })}
      <ModelSheet
        open={step === 'model'}
        onClose={close}
        models={catalog.data?.models ?? []}
        loading={catalog.isLoading}
        error={catalog.data?.error}
        value={(cliId && defaults[cliId]?.model) || ''}
        onChoose={(m) => {
          if (!cliId) return
          if (m.efforts?.length) {
            setModel(m)
            setStep('effort')
          } else {
            store(cliId, { model: m.id, effort: '' })
            close()
          }
        }}
      />
      <EffortSheet
        open={step === 'effort'}
        onClose={close}
        efforts={model?.efforts ?? []}
        defaultEffort={model?.defaultEffort}
        value={(cliId && defaults[cliId]?.model === model?.id && defaults[cliId]?.effort) || ''}
        onChoose={(effort) => {
          if (cliId && model) store(cliId, { model: model.id, effort })
          close()
        }}
      />
    </Section>
  )
}

const styles = StyleSheet.create({
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space[5] },
  flex: { flex: 1 },
  list: { maxHeight: 420 }
})
