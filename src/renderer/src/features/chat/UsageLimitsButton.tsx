import { useCallback, useState } from 'react'
import { Gauge, RefreshCw } from 'lucide-react'
import type { UsageLimits } from '@shared/domain/chat'
import { IconButton } from '../../components/ui/Button'
import { Popover } from '../../components/ui/Popover'
import { api } from '../../lib/api'
import { until } from '../../lib/ago'
import { cx } from '../../lib/cx'
import { reportError } from '../../stores/notices'
import styles from './Chat.module.css'

const resetTime = (iso: string): string => new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })

/**
 * The plan's usage limits (ADR 0055): each window (5-hour, weekly, per model) with how much is used and
 * when it resets, as the CLI itself reports them. Shown in every message box whose CLI can say.
 */
export function UsageLimitsButton({ cliId, cliName }: { cliId: string; cliName?: string }) {
  const [limits, setLimits] = useState<UsageLimits | null>(null)
  const [loading, setLoading] = useState(false)
  const read = useCallback(
    (refresh: boolean) => {
      setLoading(true)
      api('chat.limits', { cliId, refresh })
        .then(setLimits, (error: unknown) => reportError(error, 'Check usage limits'))
        .finally(() => setLoading(false))
    },
    [cliId]
  )
  const shown = limits?.cliId === cliId ? limits : null

  return (
    <Popover
      label="Usage limits"
      placement="above"
      align="end"
      trigger={(props) => (
        <IconButton
          {...props}
          label="Usage limits"
          icon={<Gauge />}
          size="md"
          onClick={() => {
            props.onClick()
            read(false)
          }}
        />
      )}
    >
      {() => (
        <div className={styles.limits} aria-busy={loading}>
          <div className={styles.limitsHeader}>
            <span className={styles.limitsTitle}>
              {cliName ?? 'Plan'} limits{shown?.plan ? <span className={styles.limitsPlan}>{shown.plan}</span> : null}
            </span>
            <IconButton label="Check again" icon={<RefreshCw className={loading ? 'spin' : undefined} />} disabled={loading} onClick={() => read(true)} />
          </div>
          {!shown ? (
            <p className={styles.modelNote}>Asking {cliName ?? 'the CLI'}…</p>
          ) : (
            <>
              {shown.windows.map((w) => (
                <div key={w.id} className={styles.limit}>
                  <div className={styles.limitLine}>
                    <span className={styles.limitLabel}>{w.label}</span>
                    <span className={styles.limitValue}>{w.usedPercent === null ? '—' : `${Math.round(w.usedPercent)}% used`}</span>
                  </div>
                  <div
                    className={styles.limitBar}
                    role="meter"
                    aria-label={w.label}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={w.usedPercent ?? undefined}
                  >
                    <span
                      className={cx(styles.limitFill, (w.usedPercent ?? 0) >= 90 ? styles.limitHigh : (w.usedPercent ?? 0) >= 70 && styles.limitWarn)}
                      style={{ width: `${w.usedPercent ?? 0}%` }}
                    />
                  </div>
                  {w.resetsAt && (
                    <span className={styles.limitReset}>
                      Resets {until(w.resetsAt)} · {resetTime(w.resetsAt)}
                    </span>
                  )}
                </div>
              ))}
              {shown.note && <p className={styles.modelNote}>{shown.note}</p>}
            </>
          )}
        </div>
      )}
    </Popover>
  )
}
