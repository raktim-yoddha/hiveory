import { useEffect, useState } from 'react'
import { ArrowRight, ListChecks } from 'lucide-react'
import { EmptyState } from '../../components/ui/EmptyState'
import { cx } from '../../lib/cx'
import { useBots } from '../../stores/bots'
import { useRoutines } from '../../stores/routines'
import { when } from '../routines/routine-text'
import { useHandoffs } from './use-handoffs'
import { workBoard, type WorkColumn, type WorkItem } from './work-board'
import chat from '../chat/Chat.module.css'
import styles from './Bots.module.css'

const COLUMNS: Array<{ id: WorkColumn; title: string; empty: string }> = [
  { id: 'working', title: 'Working', empty: 'Nothing running right now.' },
  { id: 'unfinished', title: 'Didn’t finish', empty: 'No failed, missed or skipped runs in the last day.' },
  { id: 'done', title: 'Done', empty: 'Finished handoffs and runs from the last day show here.' }
]

/**
 * The work board (ADR 0028, K1): what the team owes and how it went, from handoffs and routine and
 * trigger runs. Cards sit where their real state puts them; click one to open its thread.
 */
export function WorkBoardPage() {
  const { bots, openBotThread } = useBots()
  const { runs, loaded, load } = useRoutines()
  const handoffs = useHandoffs()
  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  // ponytail: the day window is measured from when the board opened; reopening it refreshes that.
  const [now] = useState(Date.now)
  const board = workBoard(handoffs, runs, now)
  const name = (botId: string): string => bots.find((b) => b.id === botId)?.name ?? 'A deleted bot'
  const from = (item: WorkItem): string => (item.from.kind === 'bot' ? name(item.from.botId) : item.from.kind === 'trigger' ? 'Trigger' : 'Routine')
  const total = board.working.length + board.unfinished.length + board.done.length

  return (
    <section className={chat.surface} aria-label="Work board">
      <header className={chat.chatHeader}>
        <ListChecks aria-hidden className={chat.headerIcon} />
        <div className={chat.headerText}>
          <h1 className={chat.chatHeading}>Work board</h1>
          <span className={chat.headerMeta}>Work your bots hand each other and run on their own, going now or in the last day.</span>
        </div>
      </header>
      <div className={styles.mapBody}>
        {total === 0 ? (
          <EmptyState
            icon={<ListChecks />}
            title="No work yet"
            description="When a Chief hands a bot work, or a routine or trigger runs, it shows here until a day after it ends."
          />
        ) : (
          <div className={styles.teamCards}>
            {COLUMNS.map((column) => (
              <section key={column.id} className={styles.teamCard} aria-label={column.title}>
                <header className={styles.teamCardHead}>
                  <h2 className={styles.cardTitle}>{column.title}</h2>
                  <span className={styles.teamCount}>{board[column.id].length}</span>
                </header>
                {board[column.id].length === 0 ? (
                  <p className={styles.switchHint}>{column.empty}</p>
                ) : (
                  <ul className={styles.handoffList}>
                    {board[column.id].map((item) => {
                      const open = item.threadId && bots.some((b) => b.id === item.botId) ? item.threadId : undefined
                      const body = (
                        <>
                          <span className={styles.handoffNames}>
                            {from(item)} <ArrowRight aria-label="to" /> {name(item.botId)}
                          </span>
                          <span className={styles.handoffTitle}>{item.title}</span>
                          <span className={cx(styles.handoffState, column.id === 'working' && styles.handoffRunning, column.id === 'unfinished' && styles.workProblem)}>
                            {column.id === 'working' ? `Since ${when(item.at)}` : when(item.at)}
                            {item.detail ? ` · ${item.detail}` : ''}
                          </span>
                        </>
                      )
                      return (
                        <li key={item.key}>
                          {open ? (
                            <button type="button" className={cx(styles.handoff, styles.workItem)} onClick={() => void openBotThread(item.botId, open)}>
                              {body}
                            </button>
                          ) : (
                            <div className={cx(styles.handoff, styles.workItem)}>{body}</div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
