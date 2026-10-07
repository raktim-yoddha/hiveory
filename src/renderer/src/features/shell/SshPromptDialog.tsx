import { useEffect, useState } from 'react'
import { KeyRound } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { TextInput } from '../../components/ui/TextField'
import { api } from '../../lib/api'
import { useSshPrompts } from '../../stores/hosts'
import { runAction } from '../../stores/notices'
import styles from './SshPromptDialog.module.css'

/**
 * Questions ssh asks while Hiveory connects (ADR 0025, like Orca): a password,
 * a key passphrase, a one-time code, or whether to trust a new host's key. The
 * answer goes straight back to ssh; passwords and passphrases are kept in
 * memory for this session only, never on disk.
 */
export function SshPromptDialog() {
  const queue = useSshPrompts((s) => s.queue)
  const prompt = queue[0]
  const [value, setValue] = useState('')

  useEffect(() => useSshPrompts.getState().load(), [])

  if (!prompt) return null

  const reply = (answer: string | null): void => {
    setValue('')
    useSshPrompts.getState().remove(prompt.id)
    void runAction('Answer SSH', () => api('ssh.answer', { id: prompt.id, answer }))
  }

  const confirm = prompt.kind === 'confirm'
  const hostKey = confirm && /fingerprint/i.test(prompt.prompt)
  const footer = confirm ? (
    <>
      <Button onClick={() => reply('no')}>No</Button>
      <Button variant="primary" onClick={() => reply('yes')}>
        {hostKey ? 'Trust and connect' : 'Yes'}
      </Button>
    </>
  ) : prompt.kind === 'notice' ? (
    <Button variant="primary" onClick={() => reply('')}>
      OK
    </Button>
  ) : (
    <>
      <Button onClick={() => reply(null)}>Cancel</Button>
      <Button variant="primary" onClick={() => reply(value)}>
        Continue
      </Button>
    </>
  )

  return (
    <Modal open title={hostKey ? `First connection to ${prompt.host}` : `${prompt.host} asks`} onClose={() => reply(null)} footer={footer}>
      <div className={styles.body}>
        <pre className={styles.prompt}>{prompt.prompt.trim()}</pre>
        {hostKey && (
          <p className={styles.note}>
            Check that this fingerprint matches the one the machine shows (for example with ssh-keygen -lf on its host key). Hiveory then
            remembers it in your known_hosts, like ssh does.
          </p>
        )}
        {(prompt.kind === 'secret' || prompt.kind === 'text') && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              reply(value)
            }}
          >
            <TextInput
              aria-label={prompt.prompt.trim().split('\n').pop() || 'Answer'}
              type={prompt.kind === 'secret' ? 'password' : 'text'}
              value={value}
              onChange={setValue}
              autoFocus
            />
          </form>
        )}
        {prompt.kind === 'secret' && (
          <span className={styles.note}>
            <KeyRound aria-hidden /> Kept in memory until Hiveory quits, so it is asked once. Never saved to disk.
          </span>
        )}
      </div>
    </Modal>
  )
}
