import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Ban, Check, Columns2, ImagePlus, Image as ImageIcon, Palette, SquareTerminal, X } from 'lucide-react'
import { THEMES, type ThemeId } from '@shared/domain'
import type { WallpaperImage } from '@shared/ipc/contract'
import { RangeField } from '../../components/ui/RangeField'
import { Tabs } from '../../components/ui/Tabs'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { useSettings } from '../../stores/data'
import { runAction } from '../../stores/notices'
import { crossFadeLook, setLookVariable } from '../shell/appearance'
import { SettingsPage } from './SettingsPage'
import { ThemeCard, type ThemePreview } from './ThemeCard'
import { TerminalFontSettings } from './TerminalFontSettings'
import { VsCodeThemes } from './VsCodeThemes'
import { PaneSpacingPicker, PaneStylePicker } from './PaneStylePicker'
import styles from './Settings.module.css'

/** Literal swatches: each card previews its own theme regardless of the active one. */
const PREVIEW: Record<ThemeId, ThemePreview> = {
  dark: { bg: '#000000', panel: '#0d0d0d', pane: '#151515', line: '#2a2a2a', accent: '#e0e0e0' },
  bronze: { bg: '#080706', panel: '#14110e', pane: '#1b1814', line: '#2e2820', accent: 'linear-gradient(180deg, #f1e9dc, #bba98c)' },
  silver: { bg: '#070809', panel: '#121418', pane: '#191b1f', line: '#2a2e35', accent: 'linear-gradient(180deg, #f5f7fa, #aeb5c0)' }
}

const percent = (value: number): string => `${Math.round(value * 100)}%`

/** Appearance in sections, one at a time (ADR 0043, 0044): the same section bar as every Settings page. */
type Section = 'theme' | 'panes' | 'background' | 'terminal'
const SECTIONS = [
  { value: 'theme' as const, label: 'Theme', icon: <Palette /> },
  { value: 'panes' as const, label: 'Panes', icon: <Columns2 /> },
  { value: 'background' as const, label: 'Background', icon: <ImageIcon /> },
  { value: 'terminal' as const, label: 'Terminal font', icon: <SquareTerminal /> }
]

export function AppearanceSection() {
  const { settings, update } = useSettings()
  const [images, setImages] = useState<WallpaperImage[]>([])
  const [section, setSection] = useState<Section>('theme')

  useEffect(() => {
    let live = true
    void api('wallpapers.list')
      .then((list) => live && setImages(list))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])

  const chooseTheme = (theme: ThemeId): void => {
    if (theme === settings.theme && !settings.vscodeTheme) return
    crossFadeLook({ ...settings, theme }, null)
    void update({ theme, vscodeTheme: '' })
  }

  const addImage = (): void =>
    void runAction('Add wallpaper', async () => {
      const image = await api('wallpapers.add')
      if (!image) return
      setImages((list) => [image, ...list.filter((i) => i.file !== image.file)])
      await update({ wallpaper: `image:${image.file}` })
    })

  const removeImage = (file: string): void =>
    void runAction('Remove wallpaper', async () => {
      await api('wallpapers.remove', { file })
      setImages((list) => list.filter((i) => i.file !== file))
    })

  const tile = (value: string, name: string, background: string | null, extra?: ReactNode) => (
    <div key={value || 'none'} className={styles.wallpaperItem}>
      <button
        type="button"
        role="radio"
        aria-checked={settings.wallpaper === value}
        aria-label={name}
        className={styles.wallpaperTile}
        style={background ? ({ '--tile': background } as CSSProperties) : undefined}
        onClick={() => void update({ wallpaper: value })}
      >
        {!background && <Ban aria-hidden />}
        <span className={styles.wallpaperName}>{name}</span>
        {settings.wallpaper === value && (
          <span className={styles.wallpaperCheck} aria-hidden>
            <Check />
          </span>
        )}
      </button>
      {extra}
    </div>
  )

  return (
    <SettingsPage title="Appearance" description="Choose the finish for Hiveory, or install a VS Code theme. Terminals, the editor and window chrome follow the theme.">
      <div className={styles.tabsHeader}>
        <Tabs<Section> label="Appearance sections" variant="segmented" size="lg" value={section} onChange={setSection} options={SECTIONS} className={styles.sectionTabs} />
      </div>

      {/* One Theme section: the built-in finishes, then any VS Code theme (ADR 0044). */}
      {section === 'theme' && (
      <>
      <div className={styles.themes} role="radiogroup" aria-label="Theme">
        {THEMES.map((theme, index) => (
          <ThemeCard
            key={theme.id}
            name={theme.name}
            description={theme.description}
            preview={PREVIEW[theme.id]}
            selected={!settings.vscodeTheme && settings.theme === theme.id}
            index={index}
            onSelect={() => chooseTheme(theme.id)}
          />
        ))}
      </div>
      <VsCodeThemes />
      </>
      )}

      {section === 'panes' && (
      <>
      <div className={styles.group}>
        <div className={styles.groupTitle}>Pane style</div>
        <p className={styles.groupNote}>How agents, terminals, files and pages share a worktree. Going back to Tiles spreads every tab into its own area.</p>
        <div className={styles.paneStyle}>
          <PaneStylePicker value={settings.paneStyle} onChange={(paneStyle) => void update({ paneStyle })} />
        </div>
      </div>
      <div className={styles.group}>
        <div className={styles.groupTitle}>Pane spacing</div>
        <p className={styles.groupNote}>Spaced keeps air and rounded corners between surfaces. Attached puts everything edge to edge.</p>
        <div className={styles.paneStyle}>
          <PaneSpacingPicker value={settings.paneSpacing} onChange={(paneSpacing) => void update({ paneSpacing })} />
        </div>
      </div>
      </>
      )}

      {section === 'background' && (
      <div className={styles.group}>
        <div className={styles.groupTitle}>Background</div>
        <p className={styles.groupNote}>Add any image as a wallpaper behind every panel. Hiveory keeps its own copy, sized for the screen.</p>
        <div className={styles.wallpapers} role="radiogroup" aria-label="Wallpaper">
          {tile('', 'None', null)}
          {images.map((image, index) =>
            tile(
              `image:${image.file}`,
              `Image ${images.length - index}`,
              `url("${image.thumb}") center / cover no-repeat`,
              <button type="button" className={styles.wallpaperRemove} aria-label={`Remove image ${images.length - index}`} onClick={() => removeImage(image.file)}>
                <X aria-hidden />
              </button>
            )
          )}
          <div className={styles.wallpaperItem}>
            <button type="button" className={cx(styles.wallpaperTile, styles.wallpaperAdd)} onClick={addImage}>
              <ImagePlus aria-hidden />
              <span className={styles.wallpaperName}>Add image</span>
            </button>
          </div>
        </div>
        {settings.wallpaper && (
          <div className={styles.sliders}>
            <RangeField
              label="Transparency"
              value={1 - settings.surfaceOpacity}
              min={0}
              max={1}
              step={0.01}
              format={percent}
              onPreview={(v) => setLookVariable('surfaceOpacity', 1 - v)}
              onCommit={(v) => void update({ surfaceOpacity: Math.round((1 - v) * 100) / 100 })}
            />
            <RangeField
              label="Blur"
              value={settings.wallpaperBlur}
              min={0}
              max={40}
              step={1}
              format={(v) => `${v}px`}
              onPreview={(v) => setLookVariable('wallpaperBlur', v)}
              onCommit={(v) => void update({ wallpaperBlur: v })}
            />
            <RangeField
              label="Dim"
              value={settings.wallpaperDim}
              min={0}
              max={0.8}
              step={0.01}
              format={percent}
              onPreview={(v) => setLookVariable('wallpaperDim', v)}
              onCommit={(v) => void update({ wallpaperDim: v })}
            />
          </div>
        )}
      </div>
      )}

      {section === 'terminal' && <TerminalFontSettings />}
    </SettingsPage>
  )
}
