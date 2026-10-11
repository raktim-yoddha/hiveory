import type { ReactNode } from 'react'
import { PANE_SPACINGS, PANE_STYLES, type PaneSpacing, type PaneStyle } from '@shared/domain'
import { cx } from '../../lib/cx'
import styles from './PaneStylePicker.module.css'

const STYLE_LABEL: Record<PaneStyle, { name: string; text: string }> = {
  tiles: { name: 'Tiles', text: 'Every agent, terminal and page in its own area, side by side.' },
  tabs: { name: 'Tabs', text: 'Areas hold several as tabs, like Orca. New ones open as a tab where you are.' }
}

const SPACING_LABEL: Record<PaneSpacing, { name: string; text: string }> = {
  spaced: { name: 'Spaced', text: 'Air and rounded corners between the sidebars, panes and panels.' },
  attached: { name: 'Attached', text: 'No gaps and square corners: everything meets edge to edge, like Orca.' }
}

const area = (key: string, tabs: number) => (
  <span key={key} className={styles.area}>
    <span className={styles.strip}>{Array.from({ length: tabs }, (_, i) => <span key={i} className={cx(styles.tabMark, i === 0 && styles.tabOn)} />)}</span>
  </span>
)

/** A tiny drawing of a layout: areas, and in Tabs a strip of tabs on each. */
const sketch = (tabs: boolean, attached = false) => (
  <span className={cx(styles.sketch, attached && styles.attached)} aria-hidden>
    {tabs ? [area('a', 3), area('b', 2)] : [area('a', 1), area('b', 1), area('c', 1), area('d', 1)]}
  </span>
)

function Cards<T extends string>({ label, values, value, onChange, card }: { label: string; values: readonly T[]; value: T; onChange: (value: T) => void; card: (value: T) => { name: string; text: string; sketch: ReactNode } }) {
  return (
    <div className={styles.cards} role="radiogroup" aria-label={label}>
      {values.map((v) => {
        const c = card(v)
        return (
          <button key={v} type="button" role="radio" aria-checked={value === v} className={cx(styles.card, value === v && styles.on)} onClick={() => onChange(v)}>
            {c.sketch}
            <span className={styles.name}>{c.name}</span>
            <span className={styles.text}>{c.text}</span>
          </button>
        )
      })}
    </div>
  )
}

/** Tiles or Tabs (ADR 0042), as two cards: in the welcome and in Settings › Appearance. */
export function PaneStylePicker({ value, onChange }: { value: PaneStyle; onChange: (style: PaneStyle) => void }) {
  return <Cards label="Pane style" values={PANE_STYLES} value={value} onChange={onChange} card={(s) => ({ ...STYLE_LABEL[s], sketch: sketch(s === 'tabs') })} />
}

/** Spaced or Attached (ADR 0043), as two cards: in the welcome and in Settings › Appearance. */
export function PaneSpacingPicker({ value, onChange }: { value: PaneSpacing; onChange: (spacing: PaneSpacing) => void }) {
  return <Cards label="Pane spacing" values={PANE_SPACINGS} value={value} onChange={onChange} card={(s) => ({ ...SPACING_LABEL[s], sketch: sketch(false, s === 'attached') })} />
}
