import { Check, CircleCheck, FilePlus2, FileText, Power, RefreshCw, X } from 'lucide-react'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { hiveoryClient, type AgentSkillSummary, type AgentSummary } from '../../../../shared/api/hiveory-client'

type SkillDraft = { id: string; name: string; description: string; triggers: string; instructions: string }
const emptyDraft: SkillDraft = { id: '', name: '', description: '', triggers: '', instructions: '' }

function skillMarkdown(draft: SkillDraft) {
  const triggers = draft.triggers.split(',').map((item) => item.trim()).filter(Boolean).map((item) => JSON.stringify(item)).join(', ')
  return `---\nid: ${draft.id.trim()}\nname: ${draft.name.trim()}\nversion: 1.0.0\ndescription: ${draft.description.trim()}\ntriggers: [${triggers}]\npermissions: []\n---\n${draft.instructions.trim()}\n`
}

export const HiveorySkills: React.FC = () => {
  const [skills, setSkills] = useState<AgentSkillSummary[]>([])
  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [selectedAgentId, setSelectedAgentId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [busySkillId, setBusySkillId] = useState<string | null>(null)
  const [showCreator, setShowCreator] = useState(false)
  const [draft, setDraft] = useState<SkillDraft>(emptyDraft)

  const refresh = useCallback(async (preferredAgentId?: string) => {
    setLoading(true)
    try {
      const [catalog, nextAgents] = await Promise.all([hiveoryClient.agentSkills(), hiveoryClient.agents()])
      const agentId = preferredAgentId && nextAgents.some((agent) => agent.id === preferredAgentId)
        ? preferredAgentId
        : selectedAgentId && nextAgents.some((agent) => agent.id === selectedAgentId)
          ? selectedAgentId
          : nextAgents[0]?.id ?? ''
      setAgents(nextAgents)
      setSelectedAgentId(agentId)
      setSkills(agentId ? (await hiveoryClient.agent(agentId)).skills : catalog.skills)
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Skills could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [selectedAgentId])

  useEffect(() => { void refresh() }, [refresh])

  const importSkill = async () => {
    setImporting(true)
    setError(null)
    try {
      const imported = await hiveoryClient.importAgentSkill()
      if (imported) await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The custom skill could not be imported.')
    } finally {
      setImporting(false)
    }
  }

  const toggleSkill = async (skill: AgentSkillSummary) => {
    if (!selectedAgentId) return
    setBusySkillId(skill.id)
    setError(null)
    try {
      const detail = await hiveoryClient.toggleAgentSkill({ agent_id: selectedAgentId, skill_id: skill.id, enabled: !skill.enabled })
      setSkills(detail.skills)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The skill setting could not be saved.')
    } finally {
      setBusySkillId(null)
    }
  }

  const createSkill = async () => {
    setImporting(true)
    setError(null)
    try {
      await hiveoryClient.createAgentSkill(skillMarkdown(draft))
      setDraft(emptyDraft)
      setShowCreator(false)
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The custom skill could not be created.')
    } finally {
      setImporting(false)
    }
  }

  const activeCount = useMemo(() => skills.filter((skill) => skill.enabled).length, [skills])

  return <section className="code-page-container hiveory-skills-page" aria-labelledby="hiveory-code-skills-title">
    <header className="code-page-header hiveory-skills-header">
      <div><h1 id="hiveory-code-skills-title" className="code-page-title">Skills</h1><p className="code-page-subtitle">Written once on this machine and shared with every coding CLI launched from Hiveory.</p></div>
      <div className="hiveory-inline-actions"><button type="button" className="is-secondary" onClick={() => setShowCreator(true)} disabled={importing}><FilePlus2 size={15} />Create skill</button><button type="button" className="is-secondary" onClick={() => void importSkill()} disabled={importing}><FileText size={15} />Import SKILL.md</button><button type="button" className="hiveory-icon-button" onClick={() => void refresh()} disabled={loading || importing} aria-label="Refresh skills"><RefreshCw size={15} /></button></div>
    </header>
    <div className="hiveory-skills-toolbar"><label>Agent assignment<select value={selectedAgentId} onChange={(event) => void refresh(event.target.value)} disabled={!agents.length}>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label><span>{skills.length} available to CLI sessions · {activeCount} assigned to this agent</span></div>
    {error && <div className="hiveory-feedback" role="alert">{error}</div>}
    <section className="code-rows-container hiveory-skills-list" aria-busy={loading}>
      {skills.map((skill) => <article key={skill.id} className="code-skill-row">
        <div className="code-activity-left"><div className="code-activity-icon-box"><FileText size={15} /></div><div className="code-activity-info"><span className="code-skill-name">{skill.name}</span><span className="code-activity-desc">{skill.description}</span></div></div>
        <div className="hiveory-skill-row-actions"><span className="code-skill-badge">{skill.origin === 'builtin' ? 'Built in' : 'Custom'}</span><button type="button" className={skill.enabled ? '' : 'is-secondary'} onClick={() => void toggleSkill(skill)} disabled={!selectedAgentId || busySkillId !== null}>{skill.enabled ? <><CircleCheck size={14} />Loaded</> : <><Power size={14} />Load</>}</button></div>
      </article>)}
      {!loading && !skills.length && <div className="hiveory-empty-panel"><FileText size={24} /><p>No skills are installed. Create one here or import a valid SKILL.md package.</p></div>}
    </section>
    {showCreator && <SkillCreator draft={draft} busy={importing} onChange={setDraft} onCancel={() => { if (!importing) setShowCreator(false) }} onCreate={() => void createSkill()} />}
  </section>
}

function SkillCreator({ draft, busy, onChange, onCancel, onCreate }: { draft: SkillDraft; busy: boolean; onChange: (draft: SkillDraft) => void; onCancel: () => void; onCreate: () => void }) {
  const update = <K extends keyof SkillDraft>(key: K, value: SkillDraft[K]) => onChange({ ...draft, [key]: value })
  return <div className="hiveory-modal-backdrop" role="presentation"><section className="hiveory-modal hiveory-skill-creator" role="dialog" aria-modal="true" aria-labelledby="hiveory-skill-creator-title"><div className="hiveory-modal-heading"><div><p className="hiveory-eyebrow">Local SKILL.md</p><h2 id="hiveory-skill-creator-title">Create a skill</h2></div><button className="hiveory-icon-button" onClick={onCancel} aria-label="Close skill creator"><X size={17} /></button></div><p>This creates a validated SKILL.md package in Hiveory’s local application data. Assign it to a Hiveory Agent from this page.</p><div className="hiveory-form-grid"><label>Identifier<input value={draft.id} onChange={(event) => update('id', event.target.value)} placeholder="release-check" autoFocus maxLength={64} /><small>Lowercase letters, numbers, and dashes.</small></label><label>Name<input value={draft.name} onChange={(event) => update('name', event.target.value)} placeholder="Release check" maxLength={80} /></label><label className="is-wide">Description<input value={draft.description} onChange={(event) => update('description', event.target.value)} placeholder="What this skill does" maxLength={240} /></label><label className="is-wide">Trigger phrases<input value={draft.triggers} onChange={(event) => update('triggers', event.target.value)} placeholder="release readiness, check release" maxLength={240} /><small>Comma-separated phrases that activate the skill in Hiveory.</small></label><label className="is-wide">Instructions<textarea value={draft.instructions} onChange={(event) => update('instructions', event.target.value)} rows={8} placeholder="Tell the Hiveory Agent exactly how to perform this task." maxLength={64 * 1024} /></label></div><div className="hiveory-modal-actions"><button className="is-secondary" onClick={onCancel}>Cancel</button><button disabled={busy || !draft.id.trim() || !draft.name.trim() || !draft.description.trim() || !draft.instructions.trim()} onClick={onCreate}><Check size={15} />{busy ? 'Creating…' : 'Create skill'}</button></div></section></div>
}
