import { useState } from 'react'
import { CircleDot } from 'lucide-react'
import type { IssueList } from '@shared/domain/integrations'
import { IconButton } from '../../components/ui/Button'
import { Menu, type MenuEntry } from '../../components/ui/Menu'
import { api } from '../../lib/api'

/** Optional issue picker: the Workspace's open issues from its code host, Jira or Linear (ADR 0040). */
export function IssuePicker({ projectId, onPick }: { projectId: string; onPick: (ref: string) => void }) {
  const [data, setData] = useState<IssueList | null>(null)

  // Asked each time the menu opens, so connecting a tracker meanwhile shows at once.
  const load = (): void => void api('issues.list', { projectId }).then(setData, () => setData({ issues: [], reason: 'Could not load issues.' }))

  const note = (id: string, label: string): MenuEntry => ({ type: 'item', id, label, disabled: true, onSelect: () => undefined })
  const items: MenuEntry[] = !data
    ? [note('loading', 'Loading issues…')]
    : data.reason
      ? [note('none', data.reason)]
      : data.issues.length === 0
        ? [note('empty', 'No open issues')]
        : data.issues.map((i) => ({ type: 'item' as const, id: i.key, label: `${i.key} ${i.title}`, onSelect: () => onPick(`${i.key} ${i.title}`.slice(0, 300)) }))

  return (
    <Menu
      label="Pick an issue"
      align="end"
      items={items}
      trigger={(props) => (
        <IconButton
          {...props}
          onClick={() => {
            setData(null)
            load()
            props.onClick?.()
          }}
          label="Pick an issue"
          icon={<CircleDot />}
          size="lg"
        />
      )}
    />
  )
}
