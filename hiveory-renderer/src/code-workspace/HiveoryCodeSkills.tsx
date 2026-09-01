import { FileText, RefreshCw } from 'lucide-react'
import React, { useCallback, useEffect, useState } from 'react'
import { hiveoryClient, type AgentSkillSummary } from '../api/hiveory-client'

export const HiveoryCodeSkills: React.FC = () => {
  const [skills, setSkills] = useState<AgentSkillSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const catalog = await hiveoryClient.agentSkills()
      setSkills(catalog.skills)
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Skills could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  return <section className="hiveory-automation code-page-container" aria-labelledby="hiveory-code-skills-title">
    <header className="code-page-header">
      <div><h1 id="hiveory-code-skills-title" className="code-page-title">Skills</h1><p className="code-page-subtitle">Installed instruction packages available to named agents on this desktop.</p></div>
      <button type="button" className="hiveory-icon-button" onClick={() => void refresh()} disabled={loading} aria-label="Refresh skills"><RefreshCw size={15} /></button>
    </header>
    {error && <div className="hiveory-feedback" role="alert">{error}</div>}
    <section className="code-rows-container" aria-busy={loading}>
      {skills.map((skill) => <div key={skill.id} className="code-skill-row">
        <div className="code-activity-left"><div className="code-activity-icon-box"><FileText size={16} /></div><div className="code-activity-info"><span className="code-skill-name">{skill.name}</span><span className="code-activity-desc">{skill.description}</span></div></div>
        <span className="code-skill-badge">{skill.enabled ? 'Enabled' : 'Available'}</span>
      </div>)}
      {!loading && !skills.length && <div className="hiveory-empty-panel"><FileText size={24} /><p>No skills are installed. Add a valid skill package to make it available to an Agent.</p></div>}
    </section>
  </section>
}
