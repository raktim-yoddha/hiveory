import { GitBranch } from 'lucide-react'
import type { KanbanCard } from '@shared/domain'
import { CliLogo } from '../../components/cli/CliLogo'
import { cx } from '../../lib/cx'
import { useClis } from '../../stores/data'
import { useNavigation } from '../../stores/navigation'
import styles from './Kanban.module.css'

/**
 * One real CLI instance. The logo is the CLI identity; the pet name is the
 * headline — never the provider name (STARTER_PROMPT §6).
 */
export function AgentCard({ projectId, card }: { projectId: string; card: KanbanCard }) {
  const openWorkspace = useNavigation((s) => s.openWorkspace)
  const cliName = useClis((s) => s.clis.find((c) => c.id === card.cliId)?.displayName ?? card.cliId)
  const { runtime } = card
  const detail = runtime.error ?? runtime.activity
  const status = runtime.running ? card.runtime.status : 'stopped'

  return (
    <li>
      <button
        type="button"
        className={cx(styles.card, !runtime.running && styles.stopped)}
        data-status={status}
        title={detail}
        onClick={() => openWorkspace(projectId, card.workspaceId, card.instanceId)}
        aria-label={`${card.petName}, ${cliName}, ${card.workspaceName}${detail ? `, ${detail}` : ''}`}
      >
        <span className={styles.cardTop}>
          <CliLogo cliId={card.cliId} size="lg" />
          <span className={styles.petName}>{card.petName}</span>
        </span>
        <span className={styles.workspace}>
          <GitBranch aria-hidden />
          {card.workspaceName}
        </span>
      </button>
    </li>
  )
}
