import React from 'react'
import { FileText } from 'lucide-react'

export const HiveoryCodeSkills: React.FC = () => {
  const skills = [
    {
      id: '1',
      name: 'announce-a-release',
      desc: 'When a version ships and the timeline needs telling.',
      agents: '3 agents',
    },
    {
      id: '2',
      name: 'weekly-recap',
      desc: "Every Friday — turn the week's commits into three posts.",
      agents: '2 agents',
    },
    {
      id: '3',
      name: 'evidence-filter',
      desc: 'Keep the accounts that shipped, drop the ones that posted.',
      agents: '1 agent',
    },
    {
      id: '4',
      name: 'hook-first',
      desc: 'Find the claim, cut two seconds before it.',
      agents: '1 agent',
    },
  ]

  return (
    <div className="code-page-container">
      <header className="code-page-header">
        <h1 className="code-page-title">Skills</h1>
        <p className="code-page-subtitle">Written once, on this machine, and shared by every agent you give them to.</p>
      </header>

      <section className="code-rows-container">
        {skills.map((skill) => (
          <div key={skill.id} className="code-skill-row">
            <div className="code-activity-left">
              <div className="code-activity-icon-box">
                <FileText size={16} />
              </div>
              <div className="code-activity-info">
                <span className="code-skill-name">{skill.name}</span>
                <span className="code-activity-desc">{skill.desc}</span>
              </div>
            </div>
            <span className="code-skill-badge">{skill.agents}</span>
          </div>
        ))}
      </section>
    </div>
  )
}
