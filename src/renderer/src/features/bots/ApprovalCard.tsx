import { ShieldAlert } from 'lucide-react'
import type { ApprovalRequest } from '@shared/domain/approval'
import { Button } from '../../components/ui/Button'
import styles from './Bots.module.css'

/** One bot call waiting for the user's yes (ADR 0029): what it wants to do, its arguments as plain text, Allow or Decline. */
export function ApprovalCard({ request, botName, onAnswer }: { request: ApprovalRequest; botName: string; onAnswer(allow: boolean): void }) {
  return (
    <section className={styles.approval} aria-label={`${botName} is waiting for you`}>
      <div className={styles.approvalHead}>
        <ShieldAlert aria-hidden className={styles.approvalIcon} />
        <span className={styles.switchText}>
          <span className={styles.switchTitle}>
            {botName} wants to {request.risk === 'send' ? 'send or post as you' : 'change something in your apps'}
          </span>
          <code className={styles.approvalTool}>{request.tool}</code>
        </span>
      </div>
      <details>
        <summary className={styles.switchHint}>What it will send</summary>
        <pre className={styles.prompt}>{request.detail}</pre>
      </details>
      <div className={styles.approvalActions}>
        <span className={styles.switchHint}>Declined by itself after 15 minutes.</span>
        <Button variant="ghost" onClick={() => onAnswer(false)}>
          Decline
        </Button>
        <Button variant="primary" onClick={() => onAnswer(true)}>
          Allow
        </Button>
      </div>
    </section>
  )
}
