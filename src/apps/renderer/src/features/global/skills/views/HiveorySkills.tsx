import { Check, FilePlus2, FileText, MoreHorizontal, Search, Trash2 } from 'lucide-react'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { hiveoryClient, type AgentSkillSummary } from '../../../../shared/api/hiveory-client'
import { HiveoryButton, HiveoryDialog, HiveoryEmptyState, HiveoryIconButton, HiveoryMenu, HiveoryMenuItem, HiveoryPageHeader, HiveorySearchField, useHiveoryDialogs, useHiveoryDismissibleLayer } from '../../../../shared/ui/HiveoryDesign'

type SkillDraft = { id: string; name: string; description: string; triggers: string; instructions: string }
const emptyDraft: SkillDraft = { id: '', name: '', description: '', triggers: '', instructions: '' }

function skillMarkdown(draft: SkillDraft) {
  const triggers = draft.triggers.split(',').map((item) => item.trim()).filter(Boolean).map((item) => JSON.stringify(item)).join(', ')
  return `---\nid: ${draft.id.trim()}\nname: ${draft.name.trim()}\nversion: 1.0.0\ndescription: ${draft.description.trim()}\ntriggers: [${triggers}]\npermissions: []\n---\n${draft.instructions.trim()}\n`
}

export const HiveorySkills: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const { confirm } = useHiveoryDialogs()
  const [skills, setSkills] = useState<AgentSkillSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busySkillId, setBusySkillId] = useState<string | null>(null)
  const [showCreator, setShowCreator] = useState(false)
  const [draft, setDraft] = useState<SkillDraft>(emptyDraft)
  const [query, setQuery] = useState('')
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const menuRef = useHiveoryDismissibleLayer(openMenuId !== null, () => setOpenMenuId(null))

  const refresh = useCallback(async () => {
    setLoading(true)
    try { const catalog = await hiveoryClient.agentSkills(); setSkills(catalog.skills); setError(null) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Skills could not be loaded.') } finally { setLoading(false) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => { const handleRefresh = () => { void refresh() }; window.addEventListener('hiveory-refresh-skills', handleRefresh); return () => window.removeEventListener('hiveory-refresh-skills', handleRefresh) }, [refresh])

  const importSkill = async () => {
    setBusySkillId('import'); setError(null)
    try { const imported = await hiveoryClient.importAgentSkill(); if (imported) await refresh() } catch (reason) { setError(reason instanceof Error ? reason.message : 'The custom skill could not be imported.') } finally { setBusySkillId(null) }
  }
  const createSkill = async () => {
    setBusySkillId('create'); setError(null)
    try { await hiveoryClient.createAgentSkill(skillMarkdown(draft)); setDraft(emptyDraft); setShowCreator(false); await refresh() } catch (reason) { setError(reason instanceof Error ? reason.message : 'The custom skill could not be created.') } finally { setBusySkillId(null) }
  }
  const deleteSkill = async (skill: AgentSkillSummary) => {
    const accepted = await confirm({ title: `Delete ${skill.name}?`, description: 'This permanently removes the Hiveory-managed skill and all of its assignments. This cannot be undone.', confirmLabel: 'Delete skill', intent: 'danger' })
    if (!accepted) return
    setBusySkillId(skill.id); setError(null); setOpenMenuId(null)
    try { await hiveoryClient.deleteAgentSkill(skill.id); await refresh() } catch (reason) { setError(reason instanceof Error ? reason.message : 'The skill could not be deleted. It is still available to retry.') } finally { setBusySkillId(null) }
  }

  const visibleSkills = useMemo(() => skills.filter((skill) => `${skill.name} ${skill.description}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [query, skills])
  const busy = busySkillId !== null

  return <section className={`code-page-container hiveory-skills-page ${embedded ? 'is-embedded' : ''}`} aria-labelledby="hiveory-code-skills-title">
    {!embedded && <HiveoryPageHeader id="hiveory-code-skills-title" title="Skills" className="hiveory-skills-header" />}
    <div className="hiveory-skills-toolbar"><span>{skills.length} available</span><label className="hiveory-capability-search"><Search size={17} aria-hidden="true" /><HiveorySearchField value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search skills" aria-label="Search skills" /></label></div>
    <div className="hiveory-capability-section-heading"><h2>Available skills</h2><div className="hiveory-capability-actions"><HiveoryButton type="button" intent="secondary" onClick={() => setShowCreator(true)} disabled={busy}><FilePlus2 size={15} />Create</HiveoryButton><HiveoryButton type="button" intent="secondary" onClick={() => void importSkill()} disabled={busy}><FileText size={15} />Import SKILL.md</HiveoryButton></div></div>
    {error && <div className="hiveory-feedback" role="alert">{error}</div>}
    <section className="code-rows-container hiveory-skills-list" aria-busy={loading}>
      {visibleSkills.map((skill) => <article key={skill.id} className="code-skill-row"><div className="code-activity-left"><div className="code-activity-icon-box"><FileText size={15} /></div><div className="code-activity-info"><span className="code-skill-name">{skill.name}</span><span className="code-activity-desc">{skill.description}</span></div></div><div className="hiveory-skill-row-actions">{skill.origin !== 'builtin' && <span className="code-skill-badge">{skill.origin === 'application_data' ? 'Custom' : 'Configured'}</span>}<span className="hiveory-skill-state">Available</span>{skill.origin === 'application_data' && <div ref={openMenuId === skill.id ? menuRef : undefined} className="hiveory-plugin-menu-wrap"><HiveoryIconButton type="button" aria-label={`More options for ${skill.name}`} aria-haspopup="menu" aria-expanded={openMenuId === skill.id} onClick={() => setOpenMenuId((current) => current === skill.id ? null : skill.id)} disabled={busy}><MoreHorizontal size={16} /></HiveoryIconButton>{openMenuId === skill.id && <HiveoryMenu className="hiveory-plugin-menu" label={`Options for ${skill.name}`} onClose={() => setOpenMenuId(null)}><HiveoryMenuItem intent="danger" onClick={() => void deleteSkill(skill)} disabled={busy}><Trash2 size={14} />Delete</HiveoryMenuItem></HiveoryMenu>}</div>}</div></article>)}
      {!loading && !visibleSkills.length && <HiveoryEmptyState className="hiveory-skills-empty" title={skills.length ? 'No skills match your search.' : 'No skills installed.'}><FileText size={24} /></HiveoryEmptyState>}
    </section>
    {showCreator && <SkillCreator draft={draft} busy={busySkillId === 'create'} onChange={setDraft} onCancel={() => { if (!busy) { setShowCreator(false); setDraft(emptyDraft) } }} onCreate={() => void createSkill()} />}
  </section>
}

function SkillCreator({ draft, busy, onChange, onCancel, onCreate }: { draft: SkillDraft; busy: boolean; onChange: (draft: SkillDraft) => void; onCancel: () => void; onCreate: () => void }) {
  const update = <K extends keyof SkillDraft>(key: K, value: SkillDraft[K]) => onChange({ ...draft, [key]: value })
  return <HiveoryDialog title="Create skill" description="Create a Hiveory-managed local SKILL.md package." open onClose={onCancel} size="narrow" closeDisabled={busy} actions={<><HiveoryButton type="button" intent="secondary" onClick={onCancel} disabled={busy}>Cancel</HiveoryButton><HiveoryButton type="button" intent="primary" onClick={onCreate} disabled={busy || !draft.id.trim() || !draft.name.trim() || !draft.description.trim() || !draft.instructions.trim()}><Check size={15} />{busy ? 'Creating…' : 'Create skill'}</HiveoryButton></>}><div className="hiveory-form-stack"><label>Identifier<input value={draft.id} onChange={(event) => update('id', event.target.value)} placeholder="release-check" maxLength={64} /><small>Lowercase letters, numbers, and dashes.</small></label><label>Name<input value={draft.name} onChange={(event) => update('name', event.target.value)} placeholder="Release check" maxLength={80} /></label><label>Description<input value={draft.description} onChange={(event) => update('description', event.target.value)} placeholder="What this skill does" maxLength={240} /></label><label>Trigger phrases<input value={draft.triggers} onChange={(event) => update('triggers', event.target.value)} placeholder="release readiness, check release" maxLength={240} /><small>Comma-separated phrases that activate the skill in Hiveory.</small></label><label>Instructions<textarea value={draft.instructions} onChange={(event) => update('instructions', event.target.value)} rows={8} placeholder="Tell the Hiveory Agent exactly how to perform this task." maxLength={64 * 1024} /></label></div></HiveoryDialog>
}
