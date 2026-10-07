import { useState } from 'react'
import { KeyRound } from 'lucide-react-native'
import type { SshPrompt } from '@shared/domain/tailnet'
import { useAction, useCall, useServerEvent } from '@/core/api'
import { useTheme } from '@/core/theme'
import { Button, Sheet, Text, TextField } from '@/core/ui'

/**
 * When the computer's ssh needs an answer (a password, a code, a new host's
 * fingerprint, ADR 0026), the phone can give it: the computer may be across
 * town. The answer goes to that computer only and is never stored here.
 */
export function SshPromptSheet() {
  const { colors } = useTheme()
  const pending = useCall('ssh.pending', undefined)
  // Questions asked while the phone was away (ssh.pending), then the live ones; minus those answered anywhere.
  const [live, setLive] = useState<SshPrompt[]>([])
  const [done, setDone] = useState<ReadonlySet<string>>(new Set())
  const [value, setValue] = useState('')
  const answer = useAction('ssh.answer')
  const finish = (id: string): void => setDone((d) => new Set(d).add(id))

  useServerEvent('ssh.prompt', (prompt) => setLive((q) => [...q, prompt]))
  useServerEvent('ssh.promptDone', ({ id }) => finish(id))

  const seen = new Set<string>()
  const queue = [...(pending.data ?? []), ...live].filter((p) => !done.has(p.id) && !seen.has(p.id) && seen.add(p.id))
  const prompt = queue[0]
  if (!prompt) return null
  const reply = (text: string | null): void => {
    finish(prompt.id)
    setValue('')
    answer.mutate({ id: prompt.id, answer: text })
  }
  const hostKey = prompt.kind === 'confirm' && /fingerprint/i.test(prompt.prompt)
  const footer =
    prompt.kind === 'confirm' ? (
      <>
        <Button label="No" onPress={() => reply('no')} />
        <Button label={hostKey ? 'Trust and connect' : 'Yes'} variant="primary" onPress={() => reply('yes')} />
      </>
    ) : prompt.kind === 'notice' ? (
      <Button label="OK" variant="primary" block onPress={() => reply('')} />
    ) : (
      <>
        <Button label="Cancel" onPress={() => reply(null)} />
        <Button label="Continue" variant="primary" onPress={() => reply(value)} />
      </>
    )

  return (
    <Sheet open title={hostKey ? `First connection to ${prompt.host}` : `${prompt.host} asks`} onClose={() => reply(null)} footer={footer}>
      <Text variant="mono" tone="secondary">
        {prompt.prompt.trim()}
      </Text>
      {prompt.kind === 'secret' || prompt.kind === 'text' ? (
        <TextField value={value} onChangeText={setValue} secureTextEntry={prompt.kind === 'secret'} autoFocus autoCapitalize="none" onSubmitEditing={() => reply(value)} returnKeyType="send" />
      ) : null}
      <Text variant="caption" tone="muted">
        <KeyRound size={12} color={colors.textMuted} /> Your computer asked this while connecting to {prompt.host}.
      </Text>
    </Sheet>
  )
}
