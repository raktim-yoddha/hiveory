import type { CliStatus, KanbanCard } from '@shared/domain'
import { StatusDot, STATUS_LABEL } from '../../components/ui/StatusDot'
import { AgentCard } from './AgentCard'
import styles from './Kanban.module.css'

interface KanbanColumnProps {
  projectId: string
  status: CliStatus
  cards: KanbanCard[]
}

export function KanbanColumn({ projectId, status, cards }: KanbanColumnProps) {
  const headingId = `kanban-${status}`
  return (
    <section className={styles.column} aria-labelledby={headingId}>
      <header className={styles.columnHeader}>
        <StatusDot status={status} />
        <h3 id={headingId} className={styles.columnTitle}>
          {STATUS_LABEL[status]}
        </h3>
        {/* Keyed by the count, so a change pops it (ADR 0044). */}
        <span key={cards.length} className={styles.columnCount}>
          {cards.length}
        </span>
      </header>
      <ul className={styles.cards}>
        {cards.map((card) => (
          <AgentCard key={card.instanceId} projectId={projectId} card={card} />
        ))}
      </ul>
    </section>
  )
}
