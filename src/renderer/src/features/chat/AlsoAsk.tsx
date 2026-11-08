import { Columns3 } from 'lucide-react'
import { Menu } from '../../components/ui/Menu'
import { cx } from '../../lib/cx'
import composer from './Composer.module.css'

interface AlsoAskProps {
  /** The other chat CLIs installed: id and name. */
  options: Array<{ id: string; name: string }>
  selected: string[]
  onChange: (selected: string[]) => void
}

/** Picks other CLIs that get the next message too, each in a new chat beside this one. */
export function AlsoAsk({ options, selected, onChange }: AlsoAskProps) {
  if (options.length === 0) return null
  const toggle = (id: string): void => onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id])
  return (
    <Menu
      label="Also ask"
      align="end"
      items={[
        { type: 'label', label: 'Also send the next message to' },
        ...options.map((o) => ({ type: 'item' as const, id: o.id, label: o.name, checked: selected.includes(o.id), keepOpen: true, onSelect: () => toggle(o.id) })),
        ...(selected.length ? [{ type: 'separator' as const }, { type: 'item' as const, id: 'none', label: 'Only this chat', onSelect: () => onChange([]) }] : [])
      ]}
      trigger={(props) => (
        <button
          type="button"
          {...props}
          className={cx(composer.iconPill, selected.length > 0 && composer.iconPillOn)}
          aria-label={selected.length ? `Also ask ${selected.length} more CLI${selected.length === 1 ? '' : 's'}` : 'Also ask other CLIs'}
          title={
            selected.length
              ? `The next message also goes to ${options.filter((o) => selected.includes(o.id)).map((o) => o.name).join(', ')}`
              : 'Send the next message to other CLIs too, each in a new chat beside this one'
          }
        >
          <Columns3 aria-hidden />
        </button>
      )}
    />
  )
}
