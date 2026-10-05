import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { Check, Ellipsis, Loader2, Mic, PanelBottom, PictureInPicture2, Undo2, X } from 'lucide-react'
import { PERSONAS, personaInfo, type PersonaId } from '@shared/queen/personas'
import { formatWait } from '@shared/queen/report'
import { DEFAULT_SHORTCUT, parseShortcut, shortcutLabel } from '@shared/queen/shortcut'
import { SPEECH_LANGUAGES } from '@shared/queen/voice'
import { QueenIcon } from '../../components/brand/QueenIcon'
import { Button, IconButton } from '../../components/ui/Button'
import { Menu } from '../../components/ui/Menu'
import { StatusDot } from '../../components/ui/StatusDot'
import { cx } from '../../lib/cx'
import { usePlatform } from '../../lib/platform'
import { useSettings } from '../../stores/data'
import { useNavigation } from '../../stores/navigation'
import { cancelQueen, runQueen } from './queen-run'
import { useQueen, type QueenCard } from './useQueen'
import { useQueenShortcut } from './useQueenShortcut'
import { useQueenUpdates } from './useQueenUpdates'
import { queenVoice, useVoice } from './voice'
import styles from './Queen.module.css'

const GAP = 8

/** Queen Bee docked under the main area (the screens above lift to make room). */
export function QueenDock() {
  useQueenShortcut()
  useQueenUpdates()
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
  useQueenUpdates()
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
  const { placement, setPlacement, compact, busy, card, show, focusTick, setSettingsTab } = useQueen()
  const persona = useSettings((s) => s.settings.queenPersona)
  const customName = useSettings((s) => s.settings.queenCustomName)
  const talkback = useSettings((s) => s.settings.queenTalkback)
  const info = personaInfo({ queenPersona: persona, queenCustomName: customName, queenCustomPersona: '' })
  const shortcut = useSettings((s) => s.settings.queenShortcut)
  const platform = usePlatform()
  const phase = useVoice((s) => s.phase)
  const level = useVoice((s) => s.level)
  const language = useSettings((s) => s.settings.queenSpeechLanguage)
  const listenPack = SPEECH_LANGUAGES.find((l) => l.id === language)?.pack ?? 'parakeet'
  const voiceReady = useVoice((s) => s.packs.some((p) => p.id === listenPack && p.state === 'ready'))
  const keys = shortcutLabel(parseShortcut(shortcut) ?? parseShortcut(DEFAULT_SHORTCUT)!, platform)
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
    : { onClick: () => input.current?.focus(), 'aria-label': 'Ask Queen Bee', title: `Queen Bee (${keys})` }

  return (
    <div className={styles.bar}>
      <button type="button" className={cx(styles.mark, grip && styles.grip)} {...markProps}>
        <QueenIcon aria-hidden />
      </button>
      {!compact && (
        <>
          <span className={styles.persona}>{info.name}</span>
          <input
            ref={input}
            className={styles.input}
            value={text}
            placeholder={phase === 'listening' ? 'Listening… let go to send' : phase === 'transcribing' ? 'Transcribing…' : info.placeholder}
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
          {busy || phase === 'transcribing' ? (
            <Loader2 className={cx(styles.busy, 'spin')} aria-label="Working" />
          ) : (
            <kbd className={styles.hint} title={voiceReady ? 'Tap to type, hold to talk' : 'Tap to focus'}>
              {keys}
            </kbd>
          )}
          <button
            type="button"
            className={cx(styles.mic, phase === 'listening' && styles.micOn)}
            style={{ '--level': level } as CSSProperties}
            aria-label={voiceReady ? 'Hold to talk' : 'Set up voice'}
            title={voiceReady ? `Hold to talk (or hold ${keys})` : 'Set up voice'}
            aria-pressed={phase === 'listening'}
            onPointerDown={(e) => {
              if (!voiceReady || e.button !== 0) return
              e.currentTarget.setPointerCapture(e.pointerId)
              void queenVoice.start()
            }}
            onPointerUp={() => voiceReady && void queenVoice.stop()}
            onPointerCancel={() => voiceReady && void queenVoice.stop()}
            onClick={() => {
              if (voiceReady) return
              setSettingsTab('voice')
              openSettings('queen')
            }}
          >
            <Mic aria-hidden />
          </button>
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
                label: id === 'custom' ? customName : PERSONAS[id].name,
                hint: PERSONAS[id].tagline,
                checked: persona === id,
                keepOpen: true,
                onSelect: () => void update({ queenPersona: id })
              })),
              { type: 'separator' },
              {
                type: 'item',
                id: 'talkback',
                label: 'Talk back',
                hint: talkback === 'never' ? 'Off' : talkback === 'always' ? 'Always' : 'After I speak',
                checked: talkback !== 'never',
                keepOpen: true,
                onSelect: () => void update({ queenTalkback: talkback === 'never' ? 'always' : 'never' })
              },
              {
                type: 'item',
                id: 'configure',
                label: 'Configure…',
                onSelect: () => {
                  setSettingsTab('personality')
                  openSettings('queen')
                }
              }
            ]}
            trigger={(props) => <IconButton {...props} label="Queen Bee options" icon={<Ellipsis />} />}
          />
        </>
      )}
    </div>
  )
}

/** A reply hovers over the work, so it leaves on its own; Undo gets longer. Questions and yes/no stay. */
const REPLY_MS = 10_000
const UNDO_MS = 20_000

function QueenCardView() {
  const card = useQueen((s) => s.card)
  const show = useQueen((s) => s.show)
  const busy = useQueen((s) => s.busy)
  // While the pointer or focus is on the card it stays.
  const [held, setHeld] = useState(false)

  useEffect(() => {
    if (!card || card.kind !== 'reply' || held) return
    const timer = window.setTimeout(() => {
      if (useQueen.getState().card === card) show(null)
    }, card.undo ? UNDO_MS : REPLY_MS)
    return () => window.clearTimeout(timer)
  }, [card, held, show])

  if (!card) return null
  return (
    <section
      className={styles.card}
      aria-label="Queen Bee says"
      aria-live="polite"
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(false)
      }}
    >
      <IconButton className={styles.dismiss} label="Dismiss" icon={<X />} onClick={() => show(null)} />
      {card.heard && <p className={styles.heard}>“{card.heard}”</p>}
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
          <Button size="sm" variant={card.label === 'Send' ? 'primary' : 'danger'} disabled={busy} onClick={() => void card.run()}>
            {card.label}
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
      {card.quote && (
        <figure className={styles.quote}>
          <figcaption>On its screen</figcaption>
          <blockquote>{card.quote}</blockquote>
        </figure>
      )}
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
