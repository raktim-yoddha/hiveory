import { useMemo, useState, type CSSProperties } from 'react'
import { ChevronDown, FolderInput, FolderOpen, FolderTree, Plus } from 'lucide-react'
import type { ExtensionsInventory, SkillInfo, SkillRoot } from '@shared/domain'
import { CliStack } from '../../../components/cli/CliStack'
import { Button, IconButton } from '../../../components/ui/Button'
import { Popover } from '../../../components/ui/Popover'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { TextInput } from '../../../components/ui/TextField'
import { api } from '../../../lib/api'
import { cx } from '../../../lib/cx'
import { useClis } from '../../../stores/data'
import { runAction } from '../../../stores/notices'
import { NewSkillDialog } from './NewSkillDialog'
import { SkillFolderList } from './SkillFolderList'
import settings from '../Settings.module.css'
import styles from './Extensions.module.css'

/** One skill and every folder it is copied into. */
interface SkillGroup {
  key: string
  name: string
  description?: string
  scope: SkillInfo['scope']
  copies: SkillInfo[]
}

interface Props {
  inventory: ExtensionsInventory | null
  projectId?: string
  /** A bot's own skills: its folder, which its engines read as their project (ADR 0028). */
  botId?: string
  onChanged: () => Promise<void>
}

/**
 * Agent Skills across CLIs. Each skills folder is read by different CLIs;
 * lighting a folder copies the skill there so those CLIs load it too.
 */
export function SkillsPanel({ inventory, projectId, botId, onChanged }: Props) {
  const clis = useClis((s) => s.clis)
  const installed = useMemo(() => new Set(clis.filter((c) => c.available).map((c) => c.id)), [clis])
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [removing, setRemoving] = useState<{ skill: SkillInfo; last: boolean } | null>(null)
  // Every CLI's folder is known (from the CLI registry); the ones shown are the shared folder and
  // folders an installed CLI reads. A folder that already holds a skill always shows on its row.
  const allRoots = useMemo(() => inventory?.roots ?? [], [inventory])
  const roots = useMemo(() => allRoots.filter((r) => r.id === 'agents' || r.visibleTo.some((id) => installed.has(id))), [allRoots, installed])
  const rootsFor = (group: SkillGroup): SkillRoot[] => [...roots, ...allRoots.filter((r) => !roots.includes(r) && group.copies.some((c) => c.rootId === r.id))]

  const groups = useMemo(() => {
    const map = new Map<string, SkillGroup>()
    for (const skill of inventory?.skills ?? []) {
      const key = `${skill.scope}:${skill.folder}`
      const group = map.get(key) ?? { key, name: skill.name, description: skill.description, scope: skill.scope, copies: [] }
      group.copies.push(skill)
      group.description ??= skill.description
      map.set(key, group)
    }
    const q = query.trim().toLowerCase()
    return [...map.values()].filter((g) => !q || g.name.toLowerCase().includes(q) || g.description?.toLowerCase().includes(q))
  }, [inventory, query])

  const toggleFolder = (group: SkillGroup, root: SkillRoot): void => {
    const copy = group.copies.find((c) => c.rootId === root.id)
    if (copy) {
      setRemoving({ skill: copy, last: group.copies.length === 1 })
      return
    }
    void runAction(`Add ${group.name} to ${root.label}`, async () => {
      await api('extensions.copySkill', { path: group.copies[0]!.path, rootId: root.id })
      await onChanged()
    })
  }

  const importFolder = (): void =>
    void runAction('Import skill', async () => {
      // A bot's imports go into its own folder; elsewhere, into the home folder for every project.
      if (await api('extensions.importSkill', { rootIds: ['agents', 'claude'], projectId: undefined, ...(botId ? { botId } : {}) })) await onChanged()
    })

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <div className={styles.search}>
          <TextInput value={query} onChange={setQuery} placeholder="Search skills" aria-label="Search skills" />
        </div>
        <Button size="sm" variant="ghost" icon={<FolderInput />} onClick={importFolder}>
          Import folder
        </Button>
        <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
          New skill
        </Button>
      </div>

      <div className={settings.group}>
        <p className={cx(settings.groupNote, styles.noteTop)}>
          A skill is a folder with SKILL.md. Put it in more folders to reach more CLIs — every CLI that reads a folder loads what is in it.
        </p>
        {inventory && groups.length === 0 && (
          <p className={settings.empty}>
            {query ? 'No skills match.' : 'No skills yet. Create one or import a skill folder.'}
          </p>
        )}
        <ul className={settings.list}>
          {groups.map((group, index) => {
            const loads = [...new Set(group.copies.flatMap((c) => c.visibleTo))].filter((id) => installed.has(id))
            return (
              <li key={group.key} className={cx(settings.listItem, styles.stagger)} style={{ '--i': index } as CSSProperties}>
                <div className={settings.listMain}>
                  <span className={styles.skillName}>
                    <span className={settings.listTitle}>{group.name}</span>
                    {group.scope === 'project' && <span className={styles.badge}>{botId ? 'This bot' : 'Project'}</span>}
                  </span>
                  <span className={styles.description} title={group.description}>
                    {group.description ?? 'No description'}
                  </span>
                </div>
                <span className={styles.rowSide}>
                  {/* Who loads it now, then where it lives: one compact control however many CLIs there are. */}
                  <CliStack cliIds={loads} />
                  <Popover
                    label={`Folders with ${group.name}`}
                    align="end"
                    width="lg"
                    trigger={(props) => (
                      <button type="button" {...props} className={styles.foldersButton} title="Choose which skills folders hold it">
                        <FolderTree aria-hidden />
                        {group.copies.length === 1 ? (rootsFor(group).find((r) => r.id === group.copies[0]!.rootId)?.label ?? '1 folder') : `${group.copies.length} folders`}
                        <ChevronDown aria-hidden />
                      </button>
                    )}
                  >
                    {() => (
                      <div className={styles.foldersPanel}>
                        <div className={styles.foldersHead}>
                          <span>Where {group.name} lives</span>
                          <span>Each folder reaches the CLIs shown. Removing a copy moves it to the trash.</span>
                        </div>
                        <SkillFolderList roots={rootsFor(group)} isOn={(root) => group.copies.some((c) => c.rootId === root.id)} onToggle={(root) => toggleFolder(group, root)} />
                      </div>
                    )}
                  </Popover>
                </span>
                <IconButton
                  label={`Open ${group.name} folder`}
                  icon={<FolderOpen />}
                  onClick={() => void api('extensions.revealSkill', { path: group.copies[0]!.path }).catch(() => undefined)}
                />
              </li>
            )
          })}
        </ul>
      </div>

      {creating && (
        <NewSkillDialog
        open
        roots={roots}
        projectId={projectId}
        botId={botId}
        onClose={() => setCreating(false)}
        onCreated={async () => {
          setCreating(false)
          await onChanged()
        }}
        />
      )}
      <ConfirmDialog
        open={Boolean(removing)}
        title={removing?.last ? `Remove ${removing.skill.name}?` : `Remove from ${removing?.skill.source}?`}
        confirmLabel="Move to trash"
        danger
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          const target = removing
          setRemoving(null)
          if (!target) return
          void runAction('Remove skill', async () => {
            await api('extensions.removeSkill', { path: target.skill.path })
            await onChanged()
          })
        }}
      >
        {removing?.last
          ? 'This is the only copy. It moves to the trash, so you can restore it from there.'
          : `The copy in ${removing?.skill.source} moves to the trash. The other copies stay.`}
      </ConfirmDialog>
    </div>
  )
}
