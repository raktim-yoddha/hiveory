import { useState } from 'react'
import { KeyboardAvoidingView, StyleSheet, TextInput } from 'react-native'
import { Stack } from 'expo-router'
import { useHeaderHeight } from 'expo-router/react-navigation'
import { FileWarning, Save } from 'lucide-react-native'
import { useAction, useCall } from '@/core/api'
import { font, space, useTheme } from '@/core/theme'
import { EmptyState, IconButton, Loading } from '@/core/ui'

/** Past this a phone's text box gets slow; such files are edited on the computer. */
const MAX_EDIT_CHARS = 300_000

/** One file of a worktree, read and edited as plain text; Save writes it back on the computer (ADR 0053). */
export function FileScreen({ workspaceId, path }: { workspaceId: string; path: string }) {
  const { colors } = useTheme()
  const headerHeight = useHeaderHeight()
  const scope = { workspaceId }
  const file = useCall('files.read', { scope, path })
  const write = useAction('files.write')
  const [text, setText] = useState<string | null>(null)
  // Another file starts unedited.
  const [shown, setShown] = useState(path)
  if (shown !== path) {
    setShown(path)
    setText(null)
  }
  const content = text ?? file.data?.content ?? ''
  const changed = text !== null && text !== file.data?.content
  const name = path.split('/').at(-1) ?? path

  const save = (): void => {
    if (text === null) return
    write.mutate({ scope, path, content: text }, { onSuccess: () => void file.refetch().then(() => setText(null)) })
  }

  if (file.isLoading) return <Loading />
  if (!file.data) return <EmptyState icon={FileWarning} title="Can’t open this file" body="It may have been moved, or it is not text." />
  if (file.data.content.length > MAX_EDIT_CHARS) return <EmptyState icon={FileWarning} title="Too big for a phone" body="Open it on the computer to read or edit it." />

  return (
    <>
      <Stack.Screen options={{ title: changed ? `${name} •` : name, headerRight: () => <IconButton label="Save" icon={Save} tone="accent" disabled={!changed || write.isPending} onPress={save} /> }} />
      <KeyboardAvoidingView style={[styles.fill, { backgroundColor: colors.bg }]} behavior="padding" keyboardVerticalOffset={headerHeight}>
        <TextInput
          accessibilityLabel={`Contents of ${name}`}
          value={content}
          onChangeText={setText}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          textAlignVertical="top"
          selectionColor={colors.accent}
          style={[styles.editor, { color: colors.text, fontFamily: font.mono }]}
        />
      </KeyboardAvoidingView>
    </>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  editor: { flex: 1, padding: space[5], fontSize: font.size.label }
})
