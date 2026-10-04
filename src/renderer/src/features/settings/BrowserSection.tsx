import { useState } from 'react'
import { Cookie, Download, Pencil, Plus, Trash2, Upload, X } from 'lucide-react'
import { VIEWPORT_PRESETS } from '@shared/domain'
import { Button, IconButton } from '../../components/ui/Button'
import { InlineEdit } from '../../components/ui/InlineEdit'
import { Select } from '../../components/ui/Select'
import { TextInput } from '../../components/ui/TextField'
import { Toggle } from '../../components/ui/Toggle'
import { api } from '../../lib/api'
import { useBrowser } from '../../stores/browser'
import { useSettings } from '../../stores/data'
import { runAction, useNotices } from '../../stores/notices'
import { SettingRow, SettingsPage } from './SettingsScreen'
import styles from './Settings.module.css'

const TOOLS: Array<[string, string]> = [
  ['browser_navigate / browser_snapshot', 'Open pages and read them as compact text with element refs (@12)'],
  ['browser_click / hover / drag / fill / press / select / scroll', 'Act on refs with real mouse and keyboard input and a visible cursor'],
  ['browser_batch', 'Run many steps in one call — the fast path'],
  ['browser_wait / browser_evaluate / browser_screenshot', 'Wait for text or URLs, run page JavaScript, capture images'],
  ['browser_console / browser_network / browser_devtools', 'Developer tools: console, requests, DevTools window'],
  ['browser_cookies / browser_profiles', 'Read and set cookies, use separate logins'],
  ['browser_viewport', 'Emulate phones, tablets and desktops'],
  ['browser_annotations', 'Read the notes you pin to elements'],
  ['browser_pages', 'Several pages per agent; pages show up in your side panel']
]

const notify = (message: string): void => useNotices.getState().push({ level: 'info', message })

/** Built-in browser: agent access, profiles (cookies), home page and viewport sizes. */
export function BrowserSection() {
  const { settings, update } = useSettings()
  const profiles = useBrowser((s) => s.profiles)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [newProfile, setNewProfile] = useState('')
  const [home, setHome] = useState<string | null>(null)
  const [size, setSize] = useState({ name: '', width: '', height: '' })

  const width = Number(size.width)
  const height = Number(size.height)
  const sizeValid = size.name.trim() !== '' && Number.isInteger(width) && Number.isInteger(height) && width >= 200 && width <= 4000 && height >= 200 && height <= 4000

  const addProfile = async (): Promise<void> => {
    const name = newProfile.trim()
    if (!name) return
    if (await runAction('Create profile', () => api('browser.createProfile', { name }))) setNewProfile('')
  }

  return (
    <SettingsPage
      title="Browser"
      description="The built-in browser in the side panel. Agents can drive it with real mouse and keyboard input — even while the panel is closed."
    >
      <div className={styles.group}>
        <div className={styles.groupTitle}>Browser use</div>
        <SettingRow
          title="Give agents the browser"
          description="Agents get browser_* tools over Hiveory's MCP server. Applies to the next tool call; needs Agent tools on (Settings › Agents)."
          control={<Toggle label="Give agents the browser" checked={settings.browserUse} onChange={(browserUse) => void update({ browserUse })} />}
        />
        <SettingRow
          title="Show the agent cursor"
          description="Animate a cursor with a short caption where the agent clicks, hovers and drags. Off runs actions a little faster."
          control={
            <Toggle label="Show the agent cursor" checked={settings.browserAgentCursor} onChange={(browserAgentCursor) => void update({ browserAgentCursor })} />
          }
        />
      </div>

      <div className={styles.group}>
        <div className={styles.groupTitle}>New pages</div>
        <SettingRow
          title="Home page"
          description="Where new browser tabs open. Leave empty for a blank page."
          control={
            <TextInput
              aria-label="Home page"
              placeholder="about:blank"
              value={home ?? settings.browserHomeUrl}
              onChange={setHome}
              onBlur={() => {
                if (home !== null && home.trim() !== settings.browserHomeUrl) void update({ browserHomeUrl: home.trim() })
                setHome(null)
              }}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
          }
        />
        <SettingRow
          title="Default profile"
          description="Profile for new tabs and for pages agents open."
          control={
            <Select
              label="Default profile"
              hideLabel
              value={profiles.some((p) => p.id === settings.browserDefaultProfile) ? settings.browserDefaultProfile : 'default'}
              options={profiles.map((p) => ({ value: p.id, label: p.name }))}
              onChange={(browserDefaultProfile) => void update({ browserDefaultProfile })}
            />
          }
        />
      </div>

      <div className={styles.group}>
        <div className={styles.groupTitle}>Profiles</div>
        <p className={styles.groupNote}>
          Each profile has its own cookies, logins and storage, kept on this machine. Import cookies exported from another browser (JSON from
          a cookie extension, or cookies.txt) to reuse a login.
        </p>
        <ul className={styles.list}>
          {profiles.map((p) => (
            <li key={p.id} className={styles.listItem}>
              <div className={styles.listMain}>
                {renaming === p.id ? (
                  <InlineEdit
                    label="Profile name"
                    value={p.name}
                    maxLength={40}
                    onCommit={(name) => {
                      setRenaming(null)
                      void runAction('Rename profile', () => api('browser.renameProfile', { profileId: p.id, name }))
                    }}
                    onCancel={() => setRenaming(null)}
                  />
                ) : (
                  <span className={styles.listTitle}>{p.name}</span>
                )}
                <span className={styles.listMeta}>{p.id === 'default' ? 'Default profile' : `Created ${new Date(p.createdAt).toLocaleDateString()}`}</span>
              </div>
              {p.id !== 'default' && <IconButton label={`Rename ${p.name}`} icon={<Pencil />} onClick={() => setRenaming(p.id)} />}
              <IconButton
                label={`Import cookies into ${p.name}`}
                icon={<Download />}
                onClick={async () => {
                  const r = await runAction('Import cookies', () => api('browser.importCookies', { profileId: p.id }))
                  if (r) notify(`Imported ${r.imported} cookie(s) into ${p.name}${r.failed ? ` (skipped ${r.failed})` : ''}.`)
                }}
              />
              <IconButton
                label={`Export cookies from ${p.name}`}
                icon={<Upload />}
                onClick={async () => {
                  const r = await runAction('Export cookies', () => api('browser.exportCookies', { profileId: p.id }))
                  if (r) notify(`Exported ${r.count} cookie(s) to ${r.path}.`)
                }}
              />
              <IconButton
                label={`Clear cookies and site data of ${p.name}`}
                icon={<Cookie />}
                onClick={() =>
                  void runAction('Clear data', async () => {
                    await api('browser.clearData', { profileId: p.id })
                    notify(`Cleared ${p.name}'s cookies and site data.`)
                  })
                }
              />
              {p.id !== 'default' && (
                <IconButton
                  label={`Delete ${p.name}`}
                  icon={<Trash2 />}
                  onClick={() => void runAction('Delete profile', () => api('browser.deleteProfile', { profileId: p.id }))}
                />
              )}
            </li>
          ))}
        </ul>
        <form
          className={styles.inlineForm}
          onSubmit={(e) => {
            e.preventDefault()
            void addProfile()
          }}
        >
          <TextInput aria-label="New profile name" placeholder="New profile name" value={newProfile} onChange={setNewProfile} maxLength={40} />
          <Button type="submit" icon={<Plus />} disabled={!newProfile.trim()}>
            Add profile
          </Button>
        </form>
      </div>

      <div className={styles.group}>
        <div className={styles.groupTitle}>Viewport sizes</div>
        <p className={styles.groupNote}>Built in: {VIEWPORT_PRESETS.map((v) => `${v.name} ${v.width}×${v.height}`).join(' · ')}.</p>
        {settings.browserViewports.length > 0 && (
          <ul className={styles.list}>
            {settings.browserViewports.map((v, i) => (
              <li key={`${v.name}-${i}`} className={styles.listItem}>
                <div className={styles.listMain}>
                  <span className={styles.listTitle}>{v.name}</span>
                  <span className={`${styles.listMeta} ${styles.mono}`}>
                    {v.width} × {v.height}
                  </span>
                </div>
                <IconButton
                  label={`Remove ${v.name}`}
                  icon={<X />}
                  onClick={() => void update({ browserViewports: settings.browserViewports.filter((_, j) => j !== i) })}
                />
              </li>
            ))}
          </ul>
        )}
        <form
          className={styles.inlineForm}
          onSubmit={(e) => {
            e.preventDefault()
            if (!sizeValid) return
            void update({ browserViewports: [...settings.browserViewports, { name: size.name.trim(), width, height }] })
            setSize({ name: '', width: '', height: '' })
          }}
        >
          <TextInput aria-label="Size name" placeholder="Name (e.g. iPhone 15)" value={size.name} onChange={(name) => setSize((s) => ({ ...s, name }))} maxLength={40} />
          <TextInput aria-label="Width in pixels" placeholder="Width" inputMode="numeric" value={size.width} onChange={(w) => setSize((s) => ({ ...s, width: w.replace(/\D/g, '') }))} className={styles.numberInput} />
          <TextInput aria-label="Height in pixels" placeholder="Height" inputMode="numeric" value={size.height} onChange={(h) => setSize((s) => ({ ...s, height: h.replace(/\D/g, '') }))} className={styles.numberInput} />
          <Button type="submit" icon={<Plus />} disabled={!sizeValid}>
            Add size
          </Button>
        </form>
      </div>

      <div className={styles.group}>
        <div className={styles.groupTitle}>Tools agents get</div>
        <ul className={styles.list}>
          {TOOLS.map(([name, description]) => (
            <li key={name} className={styles.listItem}>
              <div className={styles.listMain}>
                <span className={`${styles.listTitle} ${styles.mono}`}>{name}</span>
                <span className={styles.listMeta}>{description}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </SettingsPage>
  )
}
