import { useEffect } from 'react'
import { Bookmark, BookmarkPlus, Trash2 } from 'lucide-react'
import { IconButton } from '../../components/ui/Button'
import { Menu, type MenuEntry } from '../../components/ui/Menu'
import { usePrompts } from '../../stores/prompts'

/** Saved prompts (ADR 0031): insert one into the message box, save what is typed, or remove one. */
export function PromptsMenu({ text, onInsert, disabled }: { text: string; onInsert(text: string): void; disabled?: boolean }) {
  const { prompts, loaded, load, save, remove } = usePrompts()
  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  const items: MenuEntry[] = [
    ...prompts.map((p): MenuEntry => ({ type: 'item', id: p.id, label: p.title, icon: <Bookmark />, onSelect: () => onInsert(p.text) })),
    ...(prompts.length ? [{ type: 'separator' } as MenuEntry] : []),
    { type: 'item', id: 'save', label: 'Save what is typed as a prompt', icon: <BookmarkPlus />, disabled: !text.trim(), onSelect: () => void save(text) },
    ...(prompts.length
      ? [
          { type: 'label', label: 'Remove' } as MenuEntry,
          ...prompts.map((p): MenuEntry => ({ type: 'item', id: `remove-${p.id}`, label: p.title, icon: <Trash2 />, danger: true, onSelect: () => void remove(p.id) }))
        ]
      : [])
  ]
  return <Menu label="Saved prompts" items={items} trigger={(props) => <IconButton {...props} label="Saved prompts" icon={<Bookmark />} size="md" disabled={disabled} />} />
}
