import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { IconButton } from '../../components/ui/Button'
import { cx } from '../../lib/cx'
import { sameDay, weekStartOf } from './calendar-dates'
import styles from './Routines.module.css'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const HEADS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

/** A month to jump around in (the Routines page's date picker): days with runs carry a dot. */
export function MiniMonth({ value, busy, onPick }: { value: Date; busy: (day: Date) => boolean; onPick: (day: Date) => void }) {
  const [month, setMonth] = useState(() => new Date(value.getFullYear(), value.getMonth(), 1))
  const first = weekStartOf(month)
  const days = Array.from({ length: 42 }, (_, i) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + i))
  const today = new Date()
  const move = (n: number): void => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1))
  return (
    <div className={styles.miniMonth}>
      <div className={styles.miniHead}>
        <IconButton label="Previous month" icon={<ChevronLeft />} size="sm" onClick={() => move(-1)} />
        <span className={styles.miniTitle}>
          {MONTHS[month.getMonth()]} {month.getFullYear()}
        </span>
        <IconButton label="Next month" icon={<ChevronRight />} size="sm" onClick={() => move(1)} />
      </div>
      <div className={styles.miniGrid} role="grid" aria-label={`${MONTHS[month.getMonth()]} ${month.getFullYear()}`}>
        {HEADS.map((h) => (
          <span key={h} className={styles.miniDayHead} aria-hidden>
            {h}
          </span>
        ))}
        {days.map((d) => (
          <button
            key={d.toISOString()}
            type="button"
            className={cx(
              styles.miniDay,
              d.getMonth() !== month.getMonth() && styles.miniOther,
              sameDay(d, today) && styles.miniToday,
              sameDay(d, value) && styles.miniPicked
            )}
            aria-label={`${d.getDate()} ${MONTHS[d.getMonth()]}${busy(d) ? ', has runs' : ''}`}
            aria-pressed={sameDay(d, value)}
            onClick={() => onPick(d)}
          >
            {d.getDate()}
            {busy(d) && <span className={styles.miniDot} aria-hidden />}
          </button>
        ))}
      </div>
    </div>
  )
}
