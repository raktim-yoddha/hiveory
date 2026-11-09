import { useEffect, useState } from 'react'
import type { ChangeSet, ChangeSource, CommitSummary } from '@shared/domain/changes'
import type { MenuEntry } from '../../components/ui/Menu'
import { api } from '../../lib/api'
import { useChangesView } from './changes-store'

export const UNCOMMITTED: ChangeSource = { kind: 'uncommitted' }

const sourceLabel = (source: ChangeSource, commits: CommitSummary[]): string => {
  if (source.kind === 'uncommitted') return 'Uncommitted'
  if (source.kind === 'branch') return 'Branch'
  if (source.kind === 'turn') return 'One turn'
  return commits.find((c) => c.sha === source.sha)?.subject ?? source.sha.slice(0, 7)
}

/**
 * Which of a worktree's changes are shown (ADR 0058) and the menu that picks them: uncommitted work,
 * the branch against its base, one commit or one chat turn. The Changes tab and the review pane
 * (ADR 0064) share it, so both always show the same changes.
 */
export function useChangeSource(workspaceId: string, changes: ChangeSet | undefined) {
  const source = useChangesView((s) => s.source[workspaceId]) ?? UNCOMMITTED
  const setSource = useChangesView((s) => s.setSource)
  const [commits, setCommits] = useState<CommitSummary[]>([])

  useEffect(() => {
    let live = true
    void api('changes.commits', { workspaceId })
      .then((list) => live && setCommits(list))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [workspaceId, changes?.branch])

  const choose = (next: ChangeSource): void => setSource(workspaceId, next)
  const items: MenuEntry[] = [
    { type: 'item', id: 'uncommitted', label: 'Uncommitted', hint: 'Everything not committed yet', checked: source.kind === 'uncommitted', onSelect: () => choose(UNCOMMITTED) },
    { type: 'item', id: 'branch', label: 'Branch', hint: changes?.base && source.kind === 'branch' ? `Against ${changes.base}` : 'Against its base branch', checked: source.kind === 'branch', onSelect: () => choose({ kind: 'branch' }) },
    ...(source.kind === 'turn' ? [{ type: 'item' as const, id: 'turn', label: 'One turn', hint: "A chat turn's own changes", checked: true, onSelect: () => undefined }] : []),
    ...(commits.length
      ? [
          { type: 'separator' as const },
          { type: 'label' as const, label: 'Commits' },
          ...commits.slice(0, 20).map((c) => ({
            type: 'item' as const,
            id: c.sha,
            label: c.subject || c.sha.slice(0, 7),
            hint: c.sha.slice(0, 7),
            checked: source.kind === 'commit' && source.sha === c.sha,
            onSelect: () => choose({ kind: 'commit', sha: c.sha })
          }))
        ]
      : [])
  ]
  return { source, choose, commits, items, label: sourceLabel(source, commits) }
}
