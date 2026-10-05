import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { Check, Ellipsis, Loader2, PanelBottom, PictureInPicture2, Undo2, X } from 'lucide-react'
import { PERSONAS, type PersonaId } from '@shared/queen/personas'
import { formatWait } from '@shared/queen/report'
import { QueenIcon } from '../../components/brand/QueenIcon'
import { Button, IconButton } from '../../components/ui/Button'
import { Menu } from '../../components/ui/Menu'
import { StatusDot } from '../../components/ui/StatusDot'
import { cx } from '../../lib/cx'
import { useSettings } from '../../stores/data'
import { useNavigation } from '../../stores/navigation'
import { cancelQueen, runQueen } from './queen-run'
import { useQueen, type QueenCard } from './useQueen'
import styles from './Queen.module.css'

const GAP = 8
const SHORTCUT_LABEL = 'Ctrl Shift K'

/** Ctrl+Shift+K from anywhere (terminals included) moves focus to Queen Bee. Plain Ctrl+K stays readline's kill-line. */
function useQueenShortcut(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.code === 'KeyK') {
        e.preventDefault()
        e.stopPropagation()
        useQueen.getState().focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
}

/** Queen Bee docked under the main area (the screens above lift to make room). */
export function QueenDock() {
  useQueenShortcut()
  return (
    <div className={styles.dock}>
      <QueenCardView />
      <QueenBar />
    </div>
  )
}

/** Queen Bee floating over the window: drag by the hive mark, click it to shrink or expand. */
export function QueenFloating() {
  useQueenShortcut()
  const { position, compact, setPosition, setCompact } = useQueen()
  const panelOpen = useNavigation((s) => s.panelOpen)
  const panelMaximized = useNavigation((s) => s.panelMaximized)
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ dx: number; dy: number; x0: number; y0: number; moved: boolean } | null>(null)
  const [live, setLive] = useState<{ x: number; y: number } | null>(null)

  /** Keeps the bar on screen and off the native browser page, which would draw over it. */
  const settle = (x: number, y: number): { x: number; y: number } => {
    const box = ref.current?.getBoundingClientRect()
    const w = box?.width ?? 0
    const h = box?.height ?? 0
    let nx = Math.min(Math.max(GAP, x), window.innerWidth - w - GAP)
    const ny = Math.min(Math.max(GAP, y), window.innerHeight - h - GAP)
    const panel = document.querySelector('[aria-label="Side panel"]')?.getBoundingClientRect()
    if (panel && nx + w > panel.left && nx < panel.right && ny + h > panel.top && ny < panel.bottom) nx = Math.max(GAP, panel.left - w - GAP)
    return { x: Math.round(nx), y: Math.round(ny) }
  }

  // The side panel opening (or the window shrinking) may now cover the bar: move it aside.
  useLayoutEffect(() => {
    const fix = (): void => {
      const { position: current } = useQueen.getState()
      if (!current) return
      const next = settle(current.x, current.y)
      if (next.x !== current.x || next.y !== current.y) setPosition(next)
    }
    fix()
    window.addEventListener('resize', fix)
    return () => window.removeEventListener('resize', fix)
    // settle reads the DOM; re-run when the panel's footprint changes.
  }, [panelOpen, panelMaximized, compact, setPosition])

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    if (e.button !== 0) return
    const box = ref.current!.getBoundingClientRect()
    drag.current = { dx: e.clientX - box.left, dy: e.clientY - box.top, x0: e.clientX, y0: e.clientY, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    const d = drag.current
    if (!d) return
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 4) return
    d.moved = true
    setLive({ x: e.clientX - d.dx, y: e.clientY - d.dy })
  }
  const onPointerUp = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (!d.moved) return setCompact(!compact)
    setPosition(settle(e.clientX - d.dx, e.clientY - d.dy))
    setLive(null)
  }

  const at = live ?? position
  const style: CSSProperties = at ? { left: at.x, top: at.y } : { left: '50%', bottom: 24, transform: 'translateX(-50%)' }
  const flip = (at?.y ?? Infinity) < window.innerHeight / 3

  return (
    <div ref={ref} className={cx(styles.floating, compact && styles.compact, flip && styles.flip, live && styles.dragging)} style={style}>
      {!compact && <QueenCardView />}
      <QueenBar grip={{ onPointerDown, onPointerMove, onPointerUp, label: compact ? 'Expand Queen Bee (drag to move)' : 'Shrink Queen Bee (drag to move)' }} />
    </div>
  )
}

interface Grip {
  onPointerDown(e: ReactPointerEvent<HTMLButtonElement>): void
  onPointerMove(e: ReactPointerEvent<HTMLButtonElement>): void
  onPointerUp(e: ReactPointerEvent<HTMLButtonElement>): void
  label: string
}

function QueenBar({ grip }: { grip?: Grip }) {
  const { placement, setPlacement, compact, busy, card, show, focusTick } = useQueen()
  const persona = useSettings((s) => s.settings.queenPersona)
  const update = useSettings((s) => s.update)
  const openSettings = useNavigation((s) => s.openSettings)
  const [text, setText] = useState('')
  const history = useRef<string[]>([])
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (focusTick) input.current?.focus()
  }, [focusTick, compact])

  const submit = (): void => {
    const command = text.trim()
    if (!command) return
    history.current = [command, ...history.current.filter((h) => h !== command)].slice(0, 20)
    setText('')
    void runQueen(command)
  }

  const markProps = grip
    ? {
        onPointerDown: grip.onPointerDown,
        onPointerMove: grip.onPointerMove,
        onPointerUp: grip.onPointerUp,
        'aria-label': grip.label,
        title: grip.label
      }
    : { onClick: () => input.current?.focus(), 'aria-label': 'Ask Queen Bee', title: `Queen Bee (${SHORTCUT_LABEL})` }

  return (
    <div className={styles.bar}>
      <button type="button" className={cx(styles.mark, grip && styles.grip)} {...markProps}>
        <QueenIcon aria-hidden />
      </button>
      {!compact && (
        <>
          <input
            ref={input}
            className={styles.input}
            value={text}
            placeholder={PERSONAS[persona].placeholder}
            aria-label="Tell Queen Bee"
            spellCheck={false}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                submit()
              } else if (e.key === 'Escape') {
                if (card) show(null)
                else e.currentTarget.blur()
              } else if (e.key === 'ArrowUp' && !text && history.current[0]) {
                e.preventDefault()
                setText(history.current[0])
              }
            }}
          />
          {busy ? <Loader2 className={cx(styles.busy, 'spin')} aria-label="Working" /> : <kbd className={styles.hint}>{SHORTCUT_LABEL}</kbd>}
          <IconButton
            label={placement === 'docked' ? 'Float Queen Bee' : 'Dock Queen Bee'}
            icon={placement === 'docked' ? <PictureInPicture2 /> : <PanelBottom />}
            onClick={() => setPlacement(placement === 'docked' ? 'floating' : 'docked')}
          />
          <Menu
            label="Queen Bee"
            align="end"
            items={[
              { type: 'label', label: 'Personality' },
              ...(Object.keys(PERSONAS) as PersonaId[]).map((id) => ({
                type: 'item' as const,
                id,
                label: PERSONAS[id].name,
                hint: PERSONAS[id].tagline,
                checked: persona === id,
                keepOpen: true,
                onSelect: () => void update({ queenPersona: id })
              })),
              { type: 'separator' },
              { type: 'item', id: 'configure', label: 'Configure…', onSelect: () => openSettings('queen') }
            ]}
            trigger={(props) => <IconButton {...props} label="Queen Bee options" icon={<Ellipsis />} />}
          />
        </>
      )}
    </div>
  )
}

function QueenCardView() {
  const card = useQueen((s) => s.card)
  const show = useQueen((s) => s.show)
  const busy = useQueen((s) => s.busy)
  if (!card) return null
  return (
    <section className={styles.card} aria-label="Queen Bee says" aria-live="polite">
      <IconButton className={styles.dismiss} label="Dismiss" icon={<X />} onClick={() => show(null)} />
      <CardBody card={card} busy={busy} />
    </section>
  )
}

function CardBody({ card, busy }: { card: QueenCard; busy: boolean }) {
  const openWorkspace = useNavigation((s) => s.openWorkspace)
  if (card.kind === 'ask') {
    return (
      <>
        <p className={styles.text}>{card.question.text}</p>
        {card.question.choices?.length ? (
          <div className={styles.choices}>
            {card.question.choices.map((c) => (
              <Button key={c.command} size="sm" disabled={busy} onClick={() => void runQueen(c.command)}>
                {c.label}
              </Button>
            ))}
          </div>
        ) : null}
      </>
    )
  }
  if (card.kind === 'confirm') {
    return (
      <>
        <p className={styles.text}>{card.text}</p>
        <div className={styles.choices}>
          <Button size="sm" variant="danger" disabled={busy} onClick={() => void card.run()}>
            Close
          </Button>
          <Button size="sm" variant="ghost" onClick={cancelQueen}>
            Cancel
          </Button>
        </div>
      </>
    )
  }
  const rows = card.report ? [...card.report.waiting, ...card.report.working, ...card.report.idle].slice(0, 6) : []
  return (
    <>
      <p className={styles.text}>{card.text}</p>
      {rows.length > 0 && (
        <ul className={styles.rows}>
          {rows.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                className={styles.row}
                disabled={!a.projectId || !a.workspaceId}
                onClick={() => a.projectId && a.workspaceId && openWorkspace(a.projectId, a.workspaceId, a.id)}
              >
                <StatusDot status={a.status} />
                <span className={styles.rowName}>{a.petName}</span>
                <span className={styles.rowMeta}>{a.cliName} · {a.workspaceName}</span>
                <span className={styles.rowWait}>{a.waitingMinutes !== undefined ? formatWait(a.waitingMinutes) : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {(card.receipts.length > 0 || card.undo) && (
        <div className={styles.footer}>
          <ul className={styles.receipts}>
            {card.receipts.map((r, i) => (
              <li key={i}>
                <Check aria-hidden />
                {r}
              </li>
            ))}
          </ul>
          {card.undo && (
            <Button size="sm" variant="ghost" icon={<Undo2 />} disabled={busy} onClick={() => void card.undo?.()}>
              Undo
            </Button>
          )}
        </div>
      )}
    </>
  )
}
