import { useState } from 'react'
import { RotateCwSquare, X } from 'lucide-react'
import { VIEWPORT_PRESETS, type Viewport, type ViewportGroup } from '@shared/domain'
import { IconButton } from '../../components/ui/Button'
import styles from './BrowserPane.module.css'

const GROUPS: ViewportGroup[] = ['Phones', 'Tablets', 'Laptops & desktops']
const RESPONSIVE = 'Responsive'
const EDIT = '__edit'
const clamp = (n: number): number => Math.min(4000, Math.max(200, Math.round(n)))

interface DeviceToolbarProps {
  viewport: Viewport
  custom: Viewport[]
  /** Zoom at which the emulated screen is drawn (1 = actual size). */
  zoom: number
  onChange: (viewport: Viewport) => void
  onEditSizes: () => void
  onClose: () => void
}

/** Chrome-style device toolbar: device list, editable width × height, pixel ratio, rotate. */
export function DeviceToolbar({ viewport, custom, zoom, onChange, onEditSizes, onClose }: DeviceToolbarProps) {
  const devices = [...VIEWPORT_PRESETS, ...custom]
  const selected = devices.find((d) => d.name === viewport.name && d.width === viewport.width && d.height === viewport.height)?.name ?? RESPONSIVE

  const pick = (name: string): void => {
    if (name === EDIT) return onEditSizes()
    const device = devices.find((d) => d.name === name)
    if (device) onChange({ name: device.name, width: device.width, height: device.height, scale: device.scale, mobile: device.mobile })
    else onChange({ name: RESPONSIVE, width: viewport.width, height: viewport.height })
  }
  const resize = (width: number, height: number): void =>
    onChange({ ...viewport, name: RESPONSIVE, width: clamp(width), height: clamp(height) })

  return (
    <div className={styles.deviceBar} role="toolbar" aria-label="Device toolbar">
      <select className={styles.deviceSelect} aria-label="Device" value={selected} onChange={(e) => pick(e.target.value)}>
        <option value={RESPONSIVE}>Responsive</option>
        {GROUPS.map((group) => (
          <optgroup key={group} label={group}>
            {VIEWPORT_PRESETS.filter((d) => d.group === group).map((d) => (
              <option key={d.name} value={d.name}>
                {d.name}
              </option>
            ))}
          </optgroup>
        ))}
        {custom.length > 0 && (
          <optgroup label="Custom">
            {custom.map((d) => (
              <option key={`c-${d.name}`} value={d.name}>
                {d.name}
              </option>
            ))}
          </optgroup>
        )}
        <option value={EDIT}>Edit sizes…</option>
      </select>
      <Dimension label="Width" value={viewport.width} onCommit={(w) => resize(w, viewport.height)} />
      <span className={styles.deviceTimes} aria-hidden>
        ×
      </span>
      <Dimension label="Height" value={viewport.height} onCommit={(h) => resize(viewport.width, h)} />
      <select
        className={styles.deviceSelect}
        aria-label="Device pixel ratio"
        value={String(viewport.scale ?? 0)}
        onChange={(e) => onChange({ ...viewport, scale: Number(e.target.value) || undefined })}
      >
        <option value="0">DPR auto</option>
        {[1, 1.5, 2, 2.625, 3, 3.5, 4].map((r) => (
          <option key={r} value={String(r)}>
            DPR {r}
          </option>
        ))}
        {viewport.scale && ![1, 1.5, 2, 2.625, 3, 3.5, 4].includes(viewport.scale) && <option value={String(viewport.scale)}>DPR {viewport.scale}</option>}
      </select>
      <span className={styles.deviceZoom} title="Shown at this zoom to fit the panel">
        {Math.round(zoom * 100)}%
      </span>
      <IconButton label="Rotate" icon={<RotateCwSquare />} onClick={() => onChange({ ...viewport, width: viewport.height, height: viewport.width })} />
      <IconButton label="Close device toolbar" icon={<X />} onClick={onClose} />
    </div>
  )
}

/** A pixel field that commits on Enter or blur, so typing "1" on the way to "1280" never resizes the page. */
function Dimension({ label, value, onCommit }: { label: string; value: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = (): void => {
    const n = Number(draft)
    if (draft !== null && Number.isFinite(n) && n > 0 && n !== value) onCommit(n)
    setDraft(null)
  }
  return (
    <input
      className={styles.deviceDim}
      aria-label={label}
      inputMode="numeric"
      value={draft ?? String(value)}
      onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') setDraft(null)
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault()
          onCommit(value + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1))
        }
      }}
    />
  )
}
