import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Download, ExternalLink, ShieldAlert, ShieldCheck } from 'lucide-react'
import { coveringRoots, type ExtensionsInventory, type SkillAudit, type SkillRoot, type StoreSkill } from '@shared/domain'
import { CliStack } from '../../../components/cli/CliStack'
import { Button, IconButton } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import { Select } from '../../../components/ui/Select'
import { TextInput } from '../../../components/ui/TextField'
import { api } from '../../../lib/api'
import { cx } from '../../../lib/cx'
import { useClis } from '../../../stores/data'
import { runAction } from '../../../stores/notices'
import { SkillFolderList } from './SkillFolderList'
import form from '../../../components/ui/form.module.css'
import settings from '../Settings.module.css'
import styles from './Extensions.module.css'

const openUrl = (url: string): void => void api('system.openUrl', { url }).catch(() => undefined)
const folderOf = (skillId: string): string => skillId.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
const installs = (n: number): string => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n))

interface Props {
  inventory: ExtensionsInventory | null
  roots: SkillRoot[]
  projectId?: string
  botId?: string
  onChanged: () => Promise<void>
}

/**
 * skills.sh in the Skills tab (ADR 0041): search the open Agent Skills directory, see each skill's
 * security audits, and install it into the folders that reach every installed CLI at once.
 */
export function SkillStore({ inventory, roots, projectId, botId, onChanged }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ query: string; skills: StoreSkill[] } | null>(null)
  const [installing, setInstalling] = useState<StoreSkill | null>(null)
  const have = useMemo(() => new Set(inventory?.skills.map((s) => s.folder) ?? []), [inventory])
  const q = query.trim()

  // As the user types, after a short pause; skills.sh needs two letters.
  useEffect(() => {
    if (q.length < 2) return
    let live = true
    const timer = setTimeout(() => {
      void api('store.searchSkills', { query: q })
        .then((skills) => live && setResults({ query: q, skills }))
        .catch(() => live && setResults({ query: q, skills: [] }))
    }, 300)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [q])

  const shown = q.length >= 2 ? results : null

  return (
    <>
      <div className={styles.toolbar}>
        <div className={styles.search}>
          <TextInput type="search" value={query} onChange={setQuery} placeholder="Search skills.sh — react, pdf, testing, security review…" aria-label="Search skills.sh" autoFocus />
        </div>
      </div>
      <div className={settings.group}>
        <p className={cx(settings.groupNote, styles.noteTop)}>
          The open Agent Skills directory. Installing copies the skill from its GitHub repository into your skills folders; read its audits first.
        </p>
        {!shown ? (
          <p className={settings.empty}>{q.length < 2 ? 'Type at least two letters to search.' : 'Searching skills.sh…'}</p>
        ) : shown.query !== q ? (
          <p className={settings.empty}>Searching skills.sh…</p>
        ) : shown.skills.length === 0 ? (
          <p className={settings.empty}>No skills match.</p>
        ) : (
          <ul className={settings.list}>
            {shown.skills.map((skill, index) => {
              const installed = have.has(folderOf(skill.skillId))
              return (
                <li key={skill.id} className={cx(settings.listItem, styles.stagger)} style={{ '--i': index } as CSSProperties}>
                  <div className={settings.listMain}>
                    <span className={styles.skillName}>
                      <span className={settings.listTitle}>{skill.name}</span>
                      {installed && <span className={styles.badge}>Installed</span>}
                    </span>
                    <span className={styles.description}>
                      {skill.source} · {installs(skill.installs)} installs
                    </span>
                  </div>
                  <IconButton label={`Open ${skill.name} on skills.sh`} icon={<ExternalLink />} onClick={() => openUrl(`https://skills.sh/${skill.id}`)} />
                  <Button
                    size="sm"
                    icon={<Download />}
                    disabled={installed || !skill.installable}
                    title={skill.installable ? undefined : 'Not on GitHub: install it with npx skills add'}
                    onClick={() => setInstalling(skill)}
                  >
                    {installed ? 'Installed' : 'Install'}
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      {installing && (
        <InstallSkillDialog
          skill={installing}
          roots={roots}
          projectId={projectId}
          botId={botId}
          onClose={() => setInstalling(null)}
          onDone={async () => {
            setInstalling(null)
            await onChanged()
          }}
        />
      )}
    </>
  )
}

function InstallSkillDialog({ skill, roots, projectId, botId, onClose, onDone }: { skill: StoreSkill; roots: SkillRoot[]; projectId?: string; botId?: string; onClose: () => void; onDone: () => Promise<void> }) {
  const clis = useClis((s) => s.clis)
  // Installed CLIs that read skills at all (terminals don't).
  const installed = useMemo(() => new Set(clis.filter((c) => c.available && roots.some((r) => r.visibleTo.includes(c.id))).map((c) => c.id)), [clis, roots])
  // Every installed CLI by default: the shared folder plus each CLI's own where it doesn't read the shared one.
  const [targets, setTargets] = useState<string[]>(() => coveringRoots(roots, installed))
  const [scope, setScope] = useState<'user' | 'project'>(botId ? 'project' : 'user')
  const [audits, setAudits] = useState<SkillAudit[] | null>(null)
  const [busy, setBusy] = useState(false)
  const reaches = [...new Set(roots.filter((r) => targets.includes(r.id)).flatMap((r) => r.visibleTo))].filter((id) => installed.has(id))
  const warned = audits?.some((a) => a.status !== 'pass')

  useEffect(() => {
    void api('store.skillAudits', { id: skill.id }).then(setAudits, () => setAudits([]))
  }, [skill.id])

  const install = (): void => {
    setBusy(true)
    void runAction(`Install ${skill.name}`, async () => {
      await api('store.installSkill', {
        source: skill.source,
        skillId: skill.skillId,
        rootIds: targets,
        projectId: scope === 'project' ? projectId : undefined,
        ...(scope === 'project' && botId ? { botId } : {})
      })
      await onDone()
    }).finally(() => setBusy(false))
  }

  return (
    <Modal
      open
      title={`Install ${skill.name}`}
      width="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon={<Download />} loading={busy} disabled={targets.length === 0} onClick={install} data-autofocus>
            Install
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <div className={styles.audits}>
          <span className={styles.fieldTitle}>
            {warned ? <ShieldAlert aria-hidden /> : <ShieldCheck aria-hidden />} Security audits
          </span>
          {!audits ? (
            <span className={styles.hint}>Checking…</span>
          ) : audits.length === 0 ? (
            <span className={styles.hint}>No audits yet. Read the skill on skills.sh before installing it.</span>
          ) : (
            <ul className={styles.auditList}>
              {audits.map((a) => (
                <li key={a.provider} className={cx(styles.audit, a.status !== 'pass' && styles.auditWarn)} title={a.summary}>
                  <b>{a.provider}</b> {a.status === 'pass' ? 'passed' : a.status === 'warn' ? 'warns' : 'failed'}
                  {a.riskLevel ? ` · ${a.riskLevel.toLowerCase()} risk` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
        {(projectId || botId) && (
          <Select
            label="Where"
            value={scope}
            onChange={(v) => setScope(v as 'user' | 'project')}
            options={[
              { value: 'user', label: 'Everywhere (your home folder)' },
              { value: 'project', label: botId ? 'This bot only' : 'This workspace only' }
            ]}
          />
        )}
        <div className={form.field}>
          <span className={styles.fieldTitle}>Folders</span>
          <SkillFolderList roots={roots} isOn={(root) => targets.includes(root.id)} onToggle={(root) => setTargets((t) => (t.includes(root.id) ? t.filter((id) => id !== root.id) : [...t, root.id]))} />
          <span className={styles.reach}>
            Reaches <CliStack cliIds={reaches} /> {reaches.length === installed.size ? 'every installed CLI' : `${reaches.length} of ${installed.size} installed CLIs`}
          </span>
        </div>
      </div>
    </Modal>
  )
}
