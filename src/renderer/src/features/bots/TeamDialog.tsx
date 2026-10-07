import { useState } from 'react'
import { create } from 'zustand'
import { MAX_TEAM_NAME } from '@shared/domain/bot'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { TextField } from '../../components/ui/TextField'
import { useBots } from '../../stores/bots'

/** Which team the name dialog is open for: 'new', a team id, or closed. */
export const useTeamDialog = create<{ target: string | null; open(target: string): void; close(): void }>((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null })
}))

/** Name a new team, or rename one. */
export function TeamDialog() {
  const target = useTeamDialog((s) => s.target)
  return target ? <NameDialog key={target} target={target} /> : null
}

function NameDialog({ target }: { target: string }) {
  const close = useTeamDialog((s) => s.close)
  const { teams, createTeam, renameTeam } = useBots()
  const team = teams.find((t) => t.id === target)
  const [name, setName] = useState(team?.name ?? '')
  const save = async (): Promise<void> => {
    if (!name.trim()) return
    if (team) await renameTeam(team.id, name)
    else await createTeam(name)
    close()
  }
  return (
    <Modal
      open
      title={team ? `Rename ${team.name}` : 'Create team'}
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={!name.trim()}>
            {team ? 'Rename' : 'Create team'}
          </Button>
        </>
      }
    >
      <TextField
        label="Team name"
        value={name}
        maxLength={MAX_TEAM_NAME}
        placeholder="Sales, Launch, Research…"
        onChange={setName}
        onKeyDown={(e) => e.key === 'Enter' && void save()}
        autoFocus
      />
    </Modal>
  )
}
