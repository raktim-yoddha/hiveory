import { useState } from 'react'
import { CircleDot } from 'lucide-react'
import type { GithubIssue } from '@shared/domain/github'
import { IconButton } from '../../components/ui/Button'
import { Menu, type MenuEntry } from '../../components/ui/Menu'
import { api } from '../../lib/api'

/** Optional GitHub issue picker (via the GitHub CLI). Silent when GitHub isn't connected. */
export function IssuePicker({ projectId, onPick }: { projectId: string; onPick: (ref: string) => void }) {
  const [issues, setIssues] = useState<GithubIssue[] | null>(null)
  const [reason, setReason] = useState<string | null>(null)

  const load = (): void => {
    if (issues || reason) return
    void api('github.status', { projectId })
      .then((status) => {
        if (!status.available) {
          setReason(status.reason ?? 'GitHub is not connected.')
          return
        }
        return api('github.issues', { projectId }).then(setIssues)
      })
      .catch(() => setReason('Could not load issues.'))
  }

  const items: MenuEntry[] = reason
    ? [{ type: 'item', id: 'none', label: reason, disabled: true, onSelect: () => undefined }]
    : issues === null
      ? [{ type: 'item', id: 'loading', label: 'Loading issues…', disabled: true, onSelect: () => undefined }]
      : issues.length === 0
        ? [{ type: 'item', id: 'empty', label: 'No open issues', disabled: true, onSelect: () => undefined }]
        : issues.map((i) => ({ type: 'item' as const, id: String(i.number), label: `#${i.number} ${i.title}`, onSelect: () => onPick(`#${i.number} ${i.title}`) }))

  return (
    <Menu
      label="Pick an issue"
      align="end"
      items={items}
      trigger={(props) => (
        <IconButton
          {...props}
          onClick={() => {
            load()
            props.onClick?.()
          }}
          label="Pick a GitHub issue"
          icon={<CircleDot />}
          size="lg"
        />
      )}
    />
  )
}
