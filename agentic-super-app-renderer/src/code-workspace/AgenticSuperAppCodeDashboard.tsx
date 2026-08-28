import React from 'react'
import { Share2 } from 'lucide-react'

export const AgenticSuperAppCodeDashboard: React.FC = () => {
  const stats = [
    { label: 'Agents', value: '4', subtext: '1 working now' },
    { label: 'Turns today', value: '128', subtext: '31.6k tokens' },
    { label: 'Credits', value: '9,684', subtext: 'PRO · resets in 12d' },
  ]

  const activities = [
    {
      id: '1',
      title: 'X trend scout',
      desc: 'Ranked 3 threads by signal',
      time: '4m',
    },
    {
      id: '2',
      title: 'Cold outreach operator',
      desc: '10 drafts held for approval',
      time: '17m',
    },
    {
      id: '3',
      title: 'Trend video strategist',
      desc: 'Cut 3 shorts from the stream',
      time: '2h',
    },
    {
      id: '4',
      title: 'Charter writer',
      desc: 'Rewrote the authority section',
      time: '1d',
    },
  ]

  return (
    <div className="code-page-container">
      <header className="code-page-header">
        <h1 className="code-page-title">Dashboard</h1>
        <p className="code-page-subtitle">What is running, what finished, and where you are needed.</p>
      </header>

      {/* 3 Metric Cards */}
      <section className="code-dashboard-stats-grid">
        {stats.map((stat) => (
          <article key={stat.label} className="code-dashboard-stat-card">
            <span className="code-stat-label">{stat.label}</span>
            <strong className="code-stat-value">{stat.value}</strong>
            <small className="code-stat-subtext">{stat.subtext}</small>
          </article>
        ))}
      </section>

      {/* Recent Activity List */}
      <section className="code-rows-container">
        {activities.map((item) => (
          <div key={item.id} className="code-activity-row">
            <div className="code-activity-left">
              <div className="code-activity-icon-box">
                <Share2 size={16} />
              </div>
              <div className="code-activity-info">
                <span className="code-activity-title">{item.title}</span>
                <span className="code-activity-desc">{item.desc}</span>
              </div>
            </div>
            <div className="code-activity-right">
              <span className="code-live-dot" />
              <span>{item.time}</span>
            </div>
          </div>
        ))}
      </section>
    </div>
  )
}
