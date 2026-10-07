import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Ban, Check, ImagePlus, X } from 'lucide-react'
import { THEMES, type ThemeId } from '@shared/domain'
import type { WallpaperImage } from '@shared/ipc/contract'
import { RangeField } from '../../components/ui/RangeField'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { useSettings } from '../../stores/data'
import { runAction } from '../../stores/notices'
import { crossFadeLook, setLookVariable } from '../shell/appearance'
import { SettingsPage } from './SettingsScreen'
import { ThemeCard, type ThemePreview } from './ThemeCard'
import { VsCodeThemes } from './VsCodeThemes'
import styles from './Settings.module.css'

/** Literal swatches: each card previews its own theme regardless of the active one. */
const PREVIEW: Record<ThemeId, ThemePreview> = {
  dark: { bg: '#000000', panel: '#0d0d0d', pane: '#151515', line: '#2a2a2a', accent: '#e0e0e0' },
  bronze: { bg: '#080706', panel: '#14110e', pane: '#1b1814', line: '#2e2820', accent: 'linear-gradient(180deg, #f1e9dc, #bba98c)' },
  silver: { bg: '#070809', panel: '#121418', pane: '#191b1f', line: '#2a2e35', accent: 'linear-gradient(180deg, #f5f7fa, #aeb5c0)' },
  midnight: { bg: '#05070c', panel: '#0f141e', pane: '#151b27', line: '#25304a', accent: 'linear-gradient(180deg, #eef3fc, #9fb3db)' },
  jade: { bg: '#040706', panel: '#0d1411', pane: '#131c17', line: '#21332a', accent: 'linear-gradient(180deg, #eaf7f0, #93c7ab)' },
  rose: { bg: '#080608', panel: '#150f13', pane: '#1c151a', line: '#33262d', accent: 'linear-gradient(180deg, #f8e6e1, #c99a8f)' }
}

const percent = (value: number): string => `${Math.round(value * 100)}%`

export function AppearanceSection() {
  const { settings, update } = useSettings()
  const [images, setImages] = useState<WallpaperImage[]>([])

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

      <VsCodeThemes />
    </SettingsPage>
  )
}
