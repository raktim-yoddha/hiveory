import { useEffect, useRef, useState, type FormEvent } from 'react'
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
import { VIEWPORT_PRESETS, type PickedElement, type Viewport } from '@shared/domain'
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
import { isOverlayOpen, useOverlayOpen } from './useOverlayOpen'
import styles from './BrowserPane.module.css'

type PickMode = 'pick' | 'annotate'

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
  const hostRef = useRef<HTMLDivElement>(null)
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
      const el = hostRef.current
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
    if (!flash) return
    const timer = setTimeout(() => setFlash(null), 2400)
    return () => clearTimeout(timer)
  }, [flash])

  if (!page) return null
  const profile = profiles.find((p) => p.id === page.profileId)
  const pageNotes = annotations.filter((a) => a.pageId === pageId)
  const secure = page.url.startsWith('https://')
  const viewports: Viewport[] = [...VIEWPORT_PRESETS, ...settings.browserViewports]

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

  const viewportItems: MenuEntry[] = [
    { type: 'label', label: 'Viewport' },
    {
      type: 'item',
      id: 'fit',
      label: 'Responsive (panel size)',
      checked: !page.viewport,
      onSelect: () => void runAction('Set viewport', () => api('browser.viewport', { pageId, viewport: null }))
    },
    ...viewports.map(
      (v): MenuEntry => ({
        type: 'item',
        id: `vp-${v.name}`,
        label: `${v.name} — ${v.width} × ${v.height}`,
        checked: page.viewport?.width === v.width && page.viewport?.height === v.height,
        onSelect: () => void runAction('Set viewport', () => api('browser.viewport', { pageId, viewport: v }))
      })
    ),
    { type: 'separator' },
    { type: 'item', id: 'vp-edit', label: 'Custom sizes…', icon: <Settings2 />, onSelect: () => openSettings('browser') }
  ]

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
          <Menu
            label="Viewport"
            align="end"
            items={viewportItems}
            trigger={(props) => <IconButton {...props} label="Viewport size" icon={<MonitorSmartphone />} active={Boolean(page.viewport)} />}
          />
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

      {page.ownerName && (
        <div className={styles.strip}>
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

      <div ref={hostRef} className={styles.host}>
        {page.loading && <div className={styles.progress} aria-hidden />}
        {frozen && !active && <img className={styles.frozen} src={frozen} alt="" />}
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
