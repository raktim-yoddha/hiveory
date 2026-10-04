import { useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  Cookie,
  Crosshair,
  Download,
  Ellipsis,
  ExternalLink,
  Globe,
  Lock,
  MessageSquarePlus,
  MonitorSmartphone,
  RotateCw,
  Settings2,
  SquareCode,
  Trash2,
  Upload,
  UserRound,
  UserRoundPlus,
  X
} from 'lucide-react'
import type { PickedElement, Viewport } from '@shared/domain'
import { Button, IconButton } from '../../components/ui/Button'
import { Menu, type MenuEntry } from '../../components/ui/Menu'
import { Modal } from '../../components/ui/Modal'
import { TextField } from '../../components/ui/TextField'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { useBrowser } from '../../stores/browser'
import { useSettings } from '../../stores/data'
import { useNavigation } from '../../stores/navigation'
import { runAction } from '../../stores/notices'
import { DeviceToolbar } from './DeviceToolbar'
import { isOverlayOpen, useOverlayOpen } from './useOverlayOpen'
import styles from './BrowserPane.module.css'

type PickMode = 'pick' | 'annotate'

/** Room around the emulated screen for its resize handles (px). */
const HANDLE_SPACE = 24

const describeElement = (url: string, el: PickedElement): string =>
  [`Element on ${url}: ${el.role}${el.name ? ` "${el.name}"` : ''} (ref ${el.ref})`, `selector: ${el.selector}`, el.text && `text: ${el.text}`, `html: ${el.html}`]
    .filter(Boolean)
    .join('\n')

/**
 * The side panel's browser: toolbar plus a placeholder whose on-screen
 * rectangle main fills with the page's native view. Main owns the page, so
 * closing the panel never stops what an agent is doing in it.
 */
export function BrowserPane({ pageId, visible }: { pageId: string; visible: boolean }) {
  const page = useBrowser((s) => s.pages.find((p) => p.id === pageId))
  const profiles = useBrowser((s) => s.profiles)
  const annotations = useBrowser((s) => s.annotations)
  const settings = useSettings((s) => s.settings)
  const openSettings = useNavigation((s) => s.openSettings)
  const overlay = useOverlayOpen()
  /** The box main lays the native page over: the whole stage, or the emulated screen in device mode. */
  const boxRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState({ width: 0, height: 0 })
  const [deviceMode, setDeviceMode] = useState(false)
  /** Size while a resize handle is dragged (applied to the page on every frame). */
  const [dragSize, setDragSize] = useState<{ width: number; height: number } | null>(null)
  /** The viewport just chosen here, shown until main's state catches up (the next change builds on it, not on a stale one). */
  const [chosen, setChosen] = useState<{ viewport: Viewport | null } | null>(null)
  const [frozen, setFrozen] = useState<string | null>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const [picking, setPicking] = useState<PickMode | null>(null)
  const [noteFor, setNoteFor] = useState<PickedElement | null>(null)
  const [note, setNote] = useState('')
  const [flash, setFlash] = useState<string | null>(null)
  const [newProfile, setNewProfile] = useState<string | null>(null)

  const active = visible && !overlay

  useEffect(() => {
    if (!active) return
    let last = ''
    let frame = 0
    const tick = (): void => {
      const el = boxRef.current
      if (el) {
        const r = el.getBoundingClientRect()
        const key = `${r.left},${r.top},${r.width},${r.height}`
        if (key !== last) {
          last = key
          void api('browser.show', { pageId, bounds: { x: r.left, y: r.top, width: r.width, height: r.height } }).catch(() => undefined)
        }
      }
      frame = requestAnimationFrame(tick)
    }
    tick()
    return () => {
      cancelAnimationFrame(frame)
      // Stepping aside for a menu: leave a picture of the page behind it.
      const freeze = isOverlayOpen()
      void api('browser.show', { pageId, bounds: null, freeze })
        .then((picture) => freeze && picture && setFrozen(picture))
        .catch(() => undefined)
    }
  }, [active, pageId])

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setStage({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!flash) return
    const timer = setTimeout(() => setFlash(null), 2400)
    return () => clearTimeout(timer)
  }, [flash])

  if (!page) return null
  const profile = profiles.find((p) => p.id === page.profileId)
  const pageNotes = annotations.filter((a) => a.pageId === pageId)
  const secure = page.url.startsWith('https://')
  // Device mode: on when toggled, or whenever a viewport is set (agents can set one too).
  const current = chosen ? chosen.viewport : page.viewport
  const device = deviceMode || Boolean(current)
  const emulated: Viewport | null = current
    ? dragSize
      ? { ...current, name: 'Responsive', ...dragSize }
      : current
    : device
      ? { name: 'Responsive', width: Math.max(200, Math.round(stage.width - HANDLE_SPACE)), height: Math.max(200, Math.round(stage.height - HANDLE_SPACE)) }
      : null
  const zoom = emulated ? Math.min(1, (stage.width - HANDLE_SPACE) / emulated.width, (stage.height - HANDLE_SPACE) / emulated.height) : 1
  const setViewport = (viewport: Viewport | null): void => {
    const mine = { viewport }
    setChosen(mine)
    void runAction('Set viewport', () => api('browser.viewport', { pageId, viewport })).finally(() =>
      // Main has applied it; its broadcast follows within a few frames.
      setTimeout(() => setChosen((c) => (c === mine ? null : c)), 400)
    )
  }
  const toggleDevice = (): void => {
    if (device) {
      setDeviceMode(false)
      if (current) setViewport(null)
    } else {
      setDeviceMode(true)
      setViewport({ name: 'Responsive', width: Math.max(200, Math.round(stage.width - HANDLE_SPACE)), height: Math.max(200, Math.round(stage.height - HANDLE_SPACE)) })
    }
  }
  /** Drag a resize handle: width, height or both follow the pointer at the current zoom. */
  const startResize = (event: ReactPointerEvent, axis: 'x' | 'y' | 'xy'): void => {
    if (!emulated) return
    event.preventDefault()
    const start = { x: event.clientX, y: event.clientY, width: emulated.width, height: emulated.height, zoom }
    const base = emulated
    let frame = 0
    let latest = { width: base.width, height: base.height }
    const clampSize = (n: number): number => Math.min(4000, Math.max(200, Math.round(n)))
    const move = (e: PointerEvent): void => {
      latest = {
        width: axis === 'y' ? start.width : clampSize(start.width + ((e.clientX - start.x) * 2) / start.zoom),
        height: axis === 'x' ? start.height : clampSize(start.height + (e.clientY - start.y) / start.zoom)
      }
      setDragSize(latest)
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => void api('browser.viewport', { pageId, viewport: { ...base, name: 'Responsive', ...latest } }).catch(() => undefined))
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      cancelAnimationFrame(frame)
      void api('browser.viewport', { pageId, viewport: { ...base, name: 'Responsive', ...latest } })
        .catch(() => undefined)
        .finally(() => setDragSize(null))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const navigate = (url: string): void => void runAction('Open page', () => api('browser.navigate', { pageId, url }))

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (draft?.trim()) navigate(draft.trim())
    setDraft(null)
    ;(document.activeElement as HTMLElement | null)?.blur()
  }

  const startPick = async (mode: PickMode): Promise<void> => {
    if (picking) {
      setPicking(null)
      await api('browser.cancelPick', { pageId }).catch(() => undefined)
      return
    }
    setPicking(mode)
    const element = await runAction('Pick element', () => api('browser.pick', { pageId }))
    setPicking(null)
    if (!element) return
    if (mode === 'annotate') {
      setNote('')
      setNoteFor(element)
    } else {
      await api('clipboard.writeText', { text: describeElement(page.url, element) })
      setFlash(`Copied ${element.role}${element.name ? ` "${element.name.slice(0, 40)}"` : ''} — paste it to an agent`)
    }
  }

  const saveNote = async (): Promise<void> => {
    if (!noteFor || !note.trim()) return
    const saved = await runAction('Save annotation', () => api('browser.annotate', { pageId, element: noteFor, note }))
    setNoteFor(null)
    if (saved) {
      await api('clipboard.writeText', { text: `${note.trim()}\n\n${describeElement(page.url, noteFor)}` })
      setFlash('Note saved — agents read it with browser_annotations (also copied)')
    }
  }

  const cookies = async (kind: 'import' | 'export' | 'clear'): Promise<void> => {
    if (kind === 'import') {
      const r = await runAction('Import cookies', () => api('browser.importCookies', { profileId: page.profileId }))
      if (r) setFlash(`Imported ${r.imported} cookie(s)${r.failed ? `, skipped ${r.failed}` : ''}`)
    } else if (kind === 'export') {
      const r = await runAction('Export cookies', () => api('browser.exportCookies', { profileId: page.profileId }))
      if (r) setFlash(`Exported ${r.count} cookie(s)`)
    } else {
      const r = await runAction('Clear cookies', () => api('browser.clearCookies', { profileId: page.profileId }))
      if (r) setFlash(`Cleared ${r.count} cookie(s)`)
    }
  }

  const moreItems: MenuEntry[] = [
    { type: 'item', id: 'pick', label: 'Pick element', icon: <Crosshair />, hint: 'Copy', onSelect: () => void startPick('pick') },
    { type: 'item', id: 'annotate', label: 'Annotate element', icon: <MessageSquarePlus />, onSelect: () => void startPick('annotate') },
    { type: 'item', id: 'devtools', label: page.devToolsOpen ? 'Close developer tools' : 'Developer tools', icon: <SquareCode />, onSelect: () => void runAction('Developer tools', () => api('browser.devtools', { pageId })) },
    { type: 'item', id: 'external', label: 'Open in system browser', icon: <ExternalLink />, disabled: !/^https?:/.test(page.url), onSelect: () => void runAction('Open externally', () => api('browser.openExternal', { pageId })) },
    { type: 'separator' },
    { type: 'label', label: 'Profile' },
    ...profiles.map(
      (p): MenuEntry => ({
        type: 'item',
        id: `profile-${p.id}`,
        label: p.name,
        checked: p.id === page.profileId,
        onSelect: () => p.id !== page.profileId && void runAction('Switch profile', () => api('browser.switchProfile', { pageId, profileId: p.id }))
      })
    ),
    { type: 'item', id: 'new-profile', label: 'New profile…', icon: <UserRoundPlus />, onSelect: () => setNewProfile('') },
    { type: 'separator' },
    { type: 'item', id: 'import', label: 'Import cookies…', icon: <Download />, hint: 'JSON / cookies.txt', onSelect: () => void cookies('import') },
    { type: 'item', id: 'export', label: 'Export cookies…', icon: <Upload />, onSelect: () => void cookies('export') },
    { type: 'item', id: 'clear', label: 'Clear cookies', icon: <Cookie />, onSelect: () => void cookies('clear') },
    ...(pageNotes.length
      ? [
          {
            type: 'item' as const,
            id: 'clear-notes',
            label: `Clear notes (${pageNotes.length})`,
            icon: <Trash2 />,
            onSelect: () => pageNotes.forEach((a) => void api('browser.deleteAnnotation', { id: a.id }))
          }
        ]
      : []),
    { type: 'separator' },
    { type: 'item', id: 'settings', label: 'Browser settings…', icon: <Settings2 />, onSelect: () => openSettings('browser') }
  ]

  return (
    <div className={styles.pane}>
      <div className={styles.toolbar}>
        <div className={styles.nav}>
          <IconButton label="Back" icon={<ArrowLeft />} disabled={!page.canGoBack} onClick={() => navigate('back')} />
          <IconButton label="Forward" icon={<ArrowRight />} disabled={!page.canGoForward} onClick={() => navigate('forward')} />
          <IconButton
            label={page.loading ? 'Stop loading' : 'Reload'}
            icon={page.loading ? <X /> : <RotateCw />}
            onClick={() => navigate(page.loading ? 'stop' : 'reload')}
          />
        </div>
        <form className={styles.address} onSubmit={submit} role="search">
          {secure ? <Lock className={styles.addressIcon} aria-hidden /> : <Globe className={styles.addressIcon} aria-hidden />}
          <input
            className={styles.addressInput}
            aria-label="Address"
            placeholder="Search or enter address"
            value={draft ?? (page.url === 'about:blank' ? '' : page.url)}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={(e) => {
              setDraft(page.url === 'about:blank' ? '' : page.url)
              e.target.select()
            }}
            onBlur={() => setDraft(null)}
            onKeyDown={(e) => e.key === 'Escape' && (e.currentTarget.blur(), setDraft(null))}
            spellCheck={false}
            autoComplete="off"
          />
          {profile && profile.id !== 'default' && (
            <span className={styles.profileChip} title={`Profile: ${profile.name}`}>
              <UserRound aria-hidden />
              <span className={styles.profileName}>{profile.name}</span>
            </span>
          )}
          {page.viewport && <span className={styles.viewportChip}>{`${page.viewport.width}×${page.viewport.height}`}</span>}
        </form>
        <div className={styles.tools}>
          <IconButton
            className={styles.wide}
            label={picking === 'pick' ? 'Cancel picking' : 'Pick element (copies it for an agent)'}
            icon={<Crosshair />}
            active={picking === 'pick'}
            onClick={() => void startPick('pick')}
          />
          <IconButton
            className={styles.wide}
            label={picking === 'annotate' ? 'Cancel annotating' : `Annotate element${pageNotes.length ? ` (${pageNotes.length} notes)` : ''}`}
            icon={<MessageSquarePlus />}
            active={picking === 'annotate'}
            onClick={() => void startPick('annotate')}
          />
          <IconButton label={device ? 'Close device toolbar' : 'Device toolbar (screen sizes)'} icon={<MonitorSmartphone />} active={device} onClick={toggleDevice} />
          <IconButton
            className={styles.wide}
            label="Developer tools"
            icon={<SquareCode />}
            active={page.devToolsOpen}
            onClick={() => void runAction('Developer tools', () => api('browser.devtools', { pageId }))}
          />
          <Menu label="Browser menu" align="end" items={moreItems} trigger={(props) => <IconButton {...props} label="More browser actions" icon={<Ellipsis />} />} />
        </div>
      </div>

      {page.ownerName && page.agentActive && (
        <div className={cx(styles.strip, styles.live)}>
          <Bot aria-hidden />
          <span>
            <strong>{page.ownerName}</strong> is using this page
          </span>
        </div>
      )}
      {picking && (
        <div className={styles.strip} role="status">
          <Crosshair aria-hidden />
          <span>{picking === 'annotate' ? 'Click the element to annotate' : 'Click an element to copy it'} · Esc to cancel</span>
        </div>
      )}
      {noteFor && (
        <form
          className={styles.noteBar}
          onSubmit={(e) => {
            e.preventDefault()
            void saveNote()
          }}
        >
          <MessageSquarePlus aria-hidden />
          <span className={styles.noteTarget} title={noteFor.selector}>
            {noteFor.role}
            {noteFor.name ? ` "${noteFor.name}"` : ''}
          </span>
          <input
            className={styles.noteInput}
            aria-label="Note for agents"
            placeholder="What should change here?"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setNoteFor(null)}
            autoFocus
          />
          <Button size="sm" variant="primary" type="submit" disabled={!note.trim()} icon={<Check />}>
            Save
          </Button>
          <IconButton label="Cancel note" icon={<X />} onClick={() => setNoteFor(null)} />
        </form>
      )}
      {flash && (
        <div className={cx(styles.strip, styles.flash)} role="status">
          <Check aria-hidden />
          <span>{flash}</span>
        </div>
      )}

      <div className={styles.host}>
        {device && emulated && (
          <DeviceToolbar
            viewport={emulated}
            custom={settings.browserViewports}
            zoom={zoom}
            onChange={setViewport}
            onEditSizes={() => openSettings('browser')}
            onClose={toggleDevice}
          />
        )}
        <div ref={stageRef} className={cx(styles.stage, device && styles.deviceStage)}>
          <div
            className={styles.frame}
            style={emulated ? { width: Math.max(1, Math.floor(emulated.width * zoom)), height: Math.max(1, Math.floor(emulated.height * zoom)) } : undefined}
          >
            <div ref={boxRef} className={styles.box}>
              {page.loading && <div className={styles.progress} aria-hidden />}
              {frozen && !active && <img className={styles.frozen} src={frozen} alt="" />}
            </div>
            {emulated && (
              <>
                <div className={cx(styles.handle, styles.handleX)} onPointerDown={(e) => startResize(e, 'x')} role="separator" aria-label="Resize width" />
                <div className={cx(styles.handle, styles.handleY)} onPointerDown={(e) => startResize(e, 'y')} role="separator" aria-label="Resize height" />
                <div className={cx(styles.handle, styles.handleXY)} onPointerDown={(e) => startResize(e, 'xy')} role="separator" aria-label="Resize width and height" />
              </>
            )}
          </div>
        </div>
      </div>

      <Modal
        open={newProfile !== null}
        title="New browser profile"
        onClose={() => setNewProfile(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setNewProfile(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!newProfile?.trim()}
              onClick={async () => {
                const name = newProfile?.trim() ?? ''
                setNewProfile(null)
                const created = await runAction('Create profile', () => api('browser.createProfile', { name }))
                if (created) await runAction('Switch profile', () => api('browser.switchProfile', { pageId, profileId: created.id }))
              }}
            >
              Create and switch
            </Button>
          </>
        }
      >
        <p className={styles.modalNote}>A profile keeps its own cookies, logins and storage. This page reopens in it.</p>
        <TextField label="Name" value={newProfile ?? ''} onChange={setNewProfile} placeholder="Work, Testing, Client…" autoFocus />
      </Modal>
    </div>
  )
}
