import { useEffect, useState } from 'react'
import { Palette, Search } from 'lucide-react'
import type { ThemeListing, VsCodeTheme } from '@shared/domain'
import { Button } from '../../components/ui/Button'
import { TextInput } from '../../components/ui/TextField'
import { api } from '../../lib/api'
import { findTheme, useSettings, useThemes } from '../../stores/data'
import { runAction } from '../../stores/notices'
import { crossFadeLook } from '../shell/appearance'
import { ThemeCard, type ThemePreview } from './ThemeCard'
import shared from './Settings.module.css'
import styles from './VsCodeThemes.module.css'

const SEARCH_DELAY_MS = 300

const preview = (t: VsCodeTheme): ThemePreview => ({
  bg: t.tokens['color-bg'] ?? t.chrome.background,
  panel: t.tokens['base-surface'] ?? t.chrome.background,
  pane: t.tokens['base-surface-raised'] ?? t.chrome.background,
  line: t.tokens['color-border'] ?? t.chrome.symbols,
  accent: t.tokens['color-accent'] ?? t.chrome.symbols
})

const downloads = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n))

interface Results {
  query: string
  total: number
  items: ThemeListing[]
}

/**
 * VS Code color themes (ADR 0034): what's installed, as theme cards, and the Open VSX
 * catalog to search and install from. Applying one recolors every token; the wallpaper,
 * transparency, blur and dim above still apply on top.
 */
export function VsCodeThemes() {
  const { settings, update } = useSettings()
  const installed = useThemes((s) => s.installed)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Results | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let live = true
    const q = query.trim()
    const timer = setTimeout(
      () => {
        setLoading(true)
        setError(null)
        api('themes.search', { query: q, offset: 0 })
          .then((r) => live && setResults({ query: q, ...r }))
          .catch((e: unknown) => live && setError(e instanceof Error ? e.message : 'Could not reach Open VSX.'))
          .finally(() => live && setLoading(false))
      },
      q ? SEARCH_DELAY_MS : 0
    )
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [query, retry])

  const apply = (theme: VsCodeTheme): void => {
    if (settings.vscodeTheme === theme.id) return
    crossFadeLook(settings, theme)
    void update({ vscodeTheme: theme.id })
  }

  const install = (item: ThemeListing): void => {
    setInstalling(item.id)
    void runAction(`Install ${item.displayName}`, async () => {
      const extension = await api('themes.install', { namespace: item.namespace, name: item.name })
      useThemes.getState().set([...useThemes.getState().installed.filter((e) => e.id !== extension.id), extension].sort((a, b) => a.displayName.localeCompare(b.displayName)))
      // Installing is choosing: the first theme in the extension goes on at once.
      apply(extension.themes[0]!)
    }).finally(() => setInstalling(null))
  }

  const remove = (id: string): void =>
    void runAction('Remove theme', async () => {
      await api('themes.remove', { id })
      useThemes.getState().set(useThemes.getState().installed.filter((e) => e.id !== id))
      if (settings.vscodeTheme.startsWith(`${id}/`)) {
        crossFadeLook(settings, null)
        await update({ vscodeTheme: '' })
      }
    })

  const more = (): void => {
    if (!results) return
    setLoading(true)
    void runAction('Load more themes', async () => {
      const next = await api('themes.search', { query: results.query, offset: results.items.length })
      setResults((r) => (r && r.query === results.query ? { ...r, items: [...r.items, ...next.items.filter((i) => !r.items.some((x) => x.id === i.id))] } : r))
    }).finally(() => setLoading(false))
  }

  const isInstalled = (id: string): boolean => installed.some((e) => e.id === id)
  const active = findTheme(installed, settings.vscodeTheme)

  return (
    <div className={shared.group}>
      <div className={shared.groupTitle}>VS Code themes</div>
      <p className={shared.groupNote}>
        Install any color theme from Open VSX, the open VS Code extension registry. It recolors every panel, the terminals and the editor; the background, transparency, blur and dim above still apply on top.
      </p>

      {installed.length > 0 && (
        <div className={styles.installed} role="radiogroup" aria-label="Installed VS Code themes">
          {installed.map((extension) => (
            <section key={extension.id} className={styles.extension} aria-label={extension.displayName}>
              <div className={styles.extensionHeader}>
                <span className={styles.extensionName}>{extension.displayName}</span>
                <span className={styles.extensionMeta}>
                  {extension.publisher} · v{extension.version}
                </span>
                <Button variant="ghost" size="sm" className={styles.remove} onClick={() => remove(extension.id)}>
                  Remove
                </Button>
              </div>
              <div className={shared.themes}>
                {extension.themes.map((theme, index) => (
                  <ThemeCard
                    key={theme.id}
                    name={theme.label}
                    description={theme.kind === 'light' ? 'Light' : 'Dark'}
                    preview={preview(theme)}
                    selected={active?.id === theme.id}
                    index={index}
                    onSelect={() => apply(theme)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <div className={styles.catalog}>
        <label className={styles.search}>
          <Search aria-hidden />
          <TextInput type="search" aria-label="Search VS Code themes" placeholder="Search themes — Dracula, One Dark, GitHub, Solarized…" value={query} onChange={setQuery} />
        </label>

        {error ? (
          <div className={styles.message} role="alert">
            <span>{error}</span>
            <Button size="sm" onClick={() => setRetry((n) => n + 1)}>
              Try again
            </Button>
          </div>
        ) : results && results.items.length === 0 && !loading ? (
          <div className={styles.message}>No themes match “{results.query}”.</div>
        ) : (
          <ul className={styles.results} aria-label="VS Code themes on Open VSX" aria-busy={loading}>
            {results?.items.map((item) => {
              const has = isInstalled(item.id)
              return (
                <li key={item.id} className={styles.result}>
                  {item.icon ? <img className={styles.icon} src={item.icon} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <Palette className={styles.icon} aria-hidden />}
                  <span className={styles.resultText}>
                    <span className={styles.resultName}>{item.displayName}</span>
                    <span className={styles.resultMeta}>
                      {item.namespace} · {downloads(item.downloads)} installs
                    </span>
                    {item.description && <span className={styles.resultDescription}>{item.description}</span>}
                  </span>
                  <Button
                    size="sm"
                    variant={has ? 'ghost' : 'secondary'}
                    disabled={has || (installing !== null && installing !== item.id)}
                    loading={installing === item.id}
                    aria-label={has ? `${item.displayName} is installed` : `Install ${item.displayName}`}
                    onClick={() => install(item)}
                  >
                    {has ? 'Installed' : 'Install'}
                  </Button>
                </li>
              )
            })}
          </ul>
        )}

        {results && results.items.length < results.total && !error && (
          <Button size="sm" variant="ghost" className={styles.more} loading={loading} onClick={more}>
            Show more
          </Button>
        )}
      </div>
    </div>
  )
}
