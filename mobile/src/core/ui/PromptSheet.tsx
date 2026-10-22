import { useState } from 'react'
import { Button } from './Button'
import { Sheet } from './Sheet'
import { Text } from './Text'
import { TextField } from './TextField'

export interface PromptSheetProps {
  open: boolean
  title: string
  label: string
  /** What the field starts with each time the sheet opens. */
  initial?: string
  placeholder?: string
  hint?: string
  action: string
  multiline?: boolean
  maxLength?: number
  busy?: boolean
  onSubmit: (value: string) => void
  onClose: () => void
}

/** Asks for one line (or a few) of text: a name, a path, a URL. Used wherever a phone needs to type one value. */
export function PromptSheet({ open, title, label, initial = '', placeholder, hint, action, multiline, maxLength, busy, onSubmit, onClose }: PromptSheetProps) {
  const [value, setValue] = useState(initial)
  // Starts from `initial` each time it opens (set while rendering, not in an effect).
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setValue(initial)
  }
  const submit = (): void => {
    if (value.trim()) onSubmit(value.trim())
  }
  return (
    <Sheet open={open} title={title} onClose={onClose} footer={<Button label={action} variant="primary" block loading={busy} disabled={!value.trim()} onPress={submit} />}>
      <TextField
        label={label}
        value={value}
        onChangeText={setValue}
        placeholder={placeholder}
        autoCapitalize="none"
        autoFocus
        multiline={multiline}
        maxLength={maxLength}
        returnKeyType={multiline ? 'default' : 'done'}
        onSubmitEditing={multiline ? undefined : submit}
      />
      {hint ? <Text tone="muted">{hint}</Text> : null}
    </Sheet>
  )
}
