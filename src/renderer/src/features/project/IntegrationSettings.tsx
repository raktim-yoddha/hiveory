import { useEffect, useState } from 'react'
import { CODE_HOST_INFO, CODE_HOSTS, TRACKER_INFO, TRACKERS, type CodeHostId, type IntegrationsView, type TrackerGroup, type TrackerId } from '@shared/domain/integrations'
import type { Project } from '@shared/domain'
import { Button } from '../../components/ui/Button'
import { Select } from '../../components/ui/Select'
import { api } from '../../lib/api'
import { useNavigation } from '../../stores/navigation'
import { useProjects } from '../../stores/data'
import { SettingRow } from '../settings/SettingsScreen'
import settings from '../settings/Settings.module.css'

/**
 * A Workspace's code host and issue source (ADR 0040). Unset, the origin address picks the host and
 * issues come from it; trackers are connected once in Settings › Integrations.
 */
export function IntegrationSettings({ project }: { project: Project }) {
  const update = useProjects((s) => s.update)
  const openSettings = useNavigation((s) => s.openSettings)
  const [view, setView] = useState<IntegrationsView | null>(null)
  const [loaded, setLoaded] = useState<{ tracker: TrackerId; groups: TrackerGroup[] } | null>(null)
  const s = project.settings ?? {}
  const tracker = s.issueSource && s.issueSource !== 'none' ? s.issueSource : undefined
  const local = Boolean(project.repositoryRoot) && !project.host

  useEffect(() => {
    void api('integrations.status', undefined).then(setView, () => undefined)
  }, [])

  const connected = (t: TrackerId): boolean => Boolean(t === 'jira' ? view?.jira : view?.linear)
  const ready = tracker && connected(tracker) ? tracker : undefined
  useEffect(() => {
    if (ready) void api('integrations.groups', { tracker: ready }).then((groups) => setLoaded({ tracker: ready, groups }), () => setLoaded({ tracker: ready, groups: [] }))
  }, [ready])
  const groups = loaded && loaded.tracker === ready ? loaded.groups : null

  return (
    <div className={settings.group}>
      <div className={settings.groupTitle}>Integrations</div>
      {local && (
        <SettingRow
          title="Code host"
          description="Where pull requests and merge requests come from. Automatic reads the origin address."
          control={
            <Select
              label="Code host"
              hideLabel
              value={s.codeHost ?? ''}
              options={[{ value: '', label: 'Automatic' }, ...CODE_HOSTS.map((id) => ({ value: id, label: CODE_HOST_INFO[id].name })), { value: 'none', label: 'Off' }]}
              onChange={(value) => void update(project.id, { settings: { codeHost: value === '' ? null : (value as CodeHostId | 'none') } })}
            />
          }
        />
      )}
      <SettingRow
        title="Issues"
        description={
          tracker && !connected(tracker) && view ? (
            <>
              {TRACKER_INFO[tracker].name} is not connected.{' '}
              <Button size="sm" variant="ghost" onClick={() => openSettings('integrations')}>
                Connect it
              </Button>
            </>
          ) : (
            'Shown in the Dashboard › Issues, where any issue can start a worktree.'
          )
        }
        control={
          <Select
            label="Issues come from"
            hideLabel
            value={s.issueSource ?? ''}
            options={[
              ...(local ? [{ value: '', label: 'The code host' }] : []),
              ...TRACKERS.map((id) => ({ value: id, label: `${TRACKER_INFO[id].name}${view && !connected(id) ? ' (not connected)' : ''}` })),
              { value: 'none', label: 'Off' }
            ]}
            onChange={(value) => void update(project.id, { settings: { issueSource: value === '' ? null : (value as TrackerId | 'none'), trackerGroup: null } })}
          />
        }
      />
      {tracker && connected(tracker) && (
        <SettingRow
          title={TRACKER_INFO[tracker].group}
          description={`The ${TRACKER_INFO[tracker].name} ${TRACKER_INFO[tracker].group.toLowerCase()} whose open issues this workspace shows.`}
          control={
            <Select
              label={`${TRACKER_INFO[tracker].name} ${TRACKER_INFO[tracker].group.toLowerCase()}`}
              hideLabel
              value={s.trackerGroup ?? ''}
              options={[
                { value: '', label: groups ? `Pick a ${TRACKER_INFO[tracker].group.toLowerCase()}` : 'Loading…', disabled: true },
                ...(groups ?? (s.trackerGroup ? [{ key: s.trackerGroup, name: s.trackerGroup }] : [])).map((g) => ({ value: g.key, label: `${g.name} (${g.key})` }))
              ]}
              onChange={(value) => void update(project.id, { settings: { trackerGroup: value || null } })}
            />
          }
        />
      )}
    </div>
  )
}
