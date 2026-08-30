import React, { useState } from 'react'
import { History } from 'lucide-react'

interface RoutineItem {
  id: string
  title: string
  subtitle: string
  schedule: string
  enabled: boolean
}

export const HiveoryCodeRoutines: React.FC = () => {
  const [routines, setRoutines] = useState<RoutineItem[]>([
    {
      id: '1',
      title: 'Morning trend sweep',
      subtitle: 'X trend scout · rank what moved overnight',
      schedule: 'Weekdays 07:00',
      enabled: true,
    },
    {
      id: '2',
      title: 'Weekly recap thread',
      subtitle: 'Trend video strategist · turn commits into three posts',
      schedule: 'Fridays 16:00',
      enabled: true,
    },
    {
      id: '3',
      title: 'Outreach batch',
      subtitle: 'Cold outreach operator · draft, never send',
      schedule: 'Mondays 09:00',
      enabled: true,
    },
    {
      id: '4',
      title: 'Charter review',
      subtitle: 'Charter writer · flag anything the code no longer does',
      schedule: 'Monthly',
      enabled: false,
    },
  ])

  const toggleRoutine = (id: string) => {
    setRoutines((prev) =>
      prev.map((item) => (item.id === id ? { ...item, enabled: !item.enabled } : item))
    )
  }

  return (
    <div className="code-page-container">
      <header className="code-page-header">
        <h1 className="code-page-title">Routines</h1>
        <p className="code-page-subtitle">Work that starts without you asking twice.</p>
      </header>

      <section className="code-rows-container">
        {routines.map((routine) => (
          <div key={routine.id} className="code-routine-row">
            <div className="code-activity-left">
              <div className="code-activity-icon-box">
                <History size={16} />
              </div>
              <div className="code-activity-info">
                <span className="code-activity-title">{routine.title}</span>
                <span className="code-activity-desc">{routine.subtitle}</span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <span className="code-routine-schedule">{routine.schedule}</span>
              <button
                type="button"
                className={`code-switch-pill ${routine.enabled ? 'on' : 'off'}`}
                onClick={() => toggleRoutine(routine.id)}
              >
                {routine.enabled ? 'On' : 'Off'}
              </button>
            </div>
          </div>
        ))}
      </section>
    </div>
  )
}
