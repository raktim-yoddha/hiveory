import { MessagesSquare } from 'lucide-react'
import { EmptyState } from '../../components/ui/EmptyState'
import styles from '../shell/AppShell.module.css'

/** Chatspace is intentionally empty in the initial release (product-spec.md). */
export function ChatspaceScreen() {
  return (
    <div className={styles.surface}>
      <EmptyState icon={<MessagesSquare />} title="Chatspace" description="Nothing here yet." />
    </div>
  )
}
