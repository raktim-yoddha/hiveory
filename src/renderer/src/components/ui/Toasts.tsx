import { AlertCircle, AlertTriangle, Info, X } from 'lucide-react'
import { useNotices } from '../../stores/notices'
import { cx } from '../../lib/cx'
import { IconButton } from './Button'
import { ErrorDetails } from './ErrorDetails'
import styles from './Toasts.module.css'

const ICONS = { info: Info, warning: AlertTriangle, error: AlertCircle }

export function Toasts() {
  const notices = useNotices((s) => s.notices)
  const dismiss = useNotices((s) => s.dismiss)
  return (
    <div className={styles.region} aria-live="polite" aria-label="Notifications">
      {notices.map((notice) => {
        const Icon = ICONS[notice.level]
        return (
          <div key={notice.id} className={cx(styles.toast, styles[notice.level])} role={notice.level === 'error' ? 'alert' : 'status'}>
            <Icon className={styles.icon} aria-hidden />
            <div className={styles.body}>
              {notice.error?.operation && <p className={styles.operation}>{notice.error.operation} failed</p>}
              <p className={styles.message}>{notice.message}</p>
              {notice.error?.hint && <p className={styles.hint}>{notice.error.hint}</p>}
              <ErrorDetails detail={notice.error?.detail} />
            </div>
            <IconButton label="Dismiss" icon={<X />} onClick={() => dismiss(notice.id)} />
          </div>
        )
      })}
    </div>
  )
}
