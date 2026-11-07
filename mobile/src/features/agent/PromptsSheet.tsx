import { Bookmark, Trash2 } from 'lucide-react-native'
import { useAction, useCall } from '@/core/api'
import { Button, confirm, IconButton, ListRow, Sheet, Text } from '@/core/ui'

/**
 * Saved prompts on the phone (ADR 0053), the same library as the computer's: tap one to put it in
 * the message box, save what is typed, or delete one.
 */
export function PromptsSheet({ open, draft, onPick, onClose }: { open: boolean; draft: string; onPick: (text: string) => void; onClose: () => void }) {
  const prompts = useCall('prompts.list', undefined, { enabled: open })
  const save = useAction('prompts.save')
  const remove = useAction('prompts.delete')
  return (
    <Sheet
      open={open}
      title="Saved prompts"
      onClose={onClose}
      footer={draft.trim() ? <Button label="Save what I typed" icon={Bookmark} block loading={save.isPending} onPress={() => save.mutate({ text: draft.trim() })} /> : undefined}
    >
      {prompts.data?.length ? (
        prompts.data.map((p) => (
          <ListRow
            key={p.id}
            title={p.title}
            subtitle={p.text}
            action={<IconButton label={`Delete ${p.title}`} icon={Trash2} onPress={() => confirm(`Delete ${p.title}?`, 'It goes from the computer too.', 'Delete', () => remove.mutate({ promptId: p.id }))} />}
            onPress={() => {
              onPick(p.text)
              onClose()
            }}
          />
        ))
      ) : (
        <Text tone="muted">{prompts.isLoading ? 'Loading…' : 'No saved prompts yet. Type one and save it here.'}</Text>
      )}
    </Sheet>
  )
}
