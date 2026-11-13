import { useState } from 'react'
import { Play, Plus } from 'lucide-react-native'
import { MAX_SCRIPTS, SCRIPT_NAME, scriptCommandProblem, withOnCreate, type WorkspaceScript } from '@shared/domain/project'
import { useTheme } from '@/core/theme'
import { Button, choose, ListRow, Section, Sheet, Text, TextField } from '@/core/ui'

/** Why a script can't be added, or null (the computer checks again). */
const problemOf = (name: string, command: string, scripts: WorkspaceScript[]): string | null => {
  if (!SCRIPT_NAME.test(name)) return 'Name it with letters and digits, up to 40 characters.'
  if (scripts.some((s) => s.name.toLowerCase() === name.toLowerCase())) return 'A script already has that name.'
  if (scripts.length >= MAX_SCRIPTS) return `A Workspace keeps up to ${MAX_SCRIPTS} scripts.`
  return scriptCommandProblem(command)
}

/**
 * A Workspace's scripts on the phone (ADR 0061): the same named commands the computer's pane "+" runs.
 * Add one here; Edit turns "every new worktree" on or off, or removes it. A worktree's "Open an agent" runs them.
 */
export function ScriptsSection({ scripts, onSave }: { scripts: WorkspaceScript[]; onSave: (next: WorkspaceScript[] | null) => void }) {
  const { colors } = useTheme()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const problem = problemOf(name.trim(), command.trim(), scripts)

  const add = (): void => {
    if (problem) return
    onSave([...scripts, { name: name.trim(), command: command.trim() }])
    setAdding(false)
    setName('')
    setCommand('')
  }

  return (
    <Section title="Scripts">
      {scripts.map((s) => (
        <ListRow
          key={s.name}
          title={s.name}
          subtitle={s.onCreate ? `${s.command} · every new worktree` : s.command}
          leading={<Play size={18} color={colors.textMuted} />}
          action={
            <Button
              label="Edit"
              size="sm"
              variant="ghost"
              onPress={() =>
                choose(s.name, [
                  {
                    label: s.onCreate ? "Don't run in new worktrees" : 'Also run in every new worktree',
                    onPress: () => onSave(scripts.map((x) => (x.name === s.name ? withOnCreate(x, !x.onCreate) : x)))
                  },
                  { label: 'Remove script', destructive: true, onPress: () => onSave(scripts.filter((x) => x.name !== s.name).length ? scripts.filter((x) => x.name !== s.name) : null) }
                ])
              }
            />
          }
        />
      ))}
      {!scripts.length ? (
        <Text variant="caption" tone="muted">
          Commands you run often — dev, test, lint — started by name in a new terminal of a worktree.
        </Text>
      ) : null}
      <Button label="Add a script" icon={Plus} onPress={() => setAdding(true)} />
      <Sheet
        open={adding}
        title="Add a script"
        onClose={() => setAdding(false)}
        footer={<Button label="Add" variant="primary" block disabled={!name.trim() || !command.trim() || Boolean(problem)} onPress={add} />}
      >
        <TextField label="Name" placeholder="dev" value={name} onChangeText={setName} maxLength={40} autoCapitalize="none" autoCorrect={false} />
        <TextField label="Command" placeholder="pnpm dev" value={command} onChangeText={setCommand} maxLength={2000} mono autoCapitalize="none" autoCorrect={false} />
        {name.trim() && command.trim() && problem ? (
          <Text variant="caption" tone="danger">
            {problem}
          </Text>
        ) : null}
      </Sheet>
    </Section>
  )
}
