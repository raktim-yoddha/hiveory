import { PANE_STYLES, type PaneStyle } from '@shared/domain'
import { cx } from '../../lib/cx'
import styles from './PaneStylePicker.module.css'

const LABEL: Record<PaneStyle, { name: string; text: string }> = {
  tiles: { name: 'Tiles', text: 'Every agent, terminal and page in its own area, side by side.' },
  tabs: { name: 'Tabs', text: 'Areas hold several as tabs, like Orca. New ones open as a tab where you are.' }
}

/** A tiny drawing of each style: areas, and in Tabs a strip of tabs on each. */
function Sketch({ style }: { style: PaneStyle }) {
  const area = (key: string, tabs: number) => (
    <span key={key} className={styles.area}>
      <span className={styles.strip}>{Array.from({ length: tabs }, (_, i) => <span key={i} className={cx(styles.tabMark, i === 0 && styles.tabOn)} />)}</span>
    </span>
  )
  return (
    <span className={styles.sketch} aria-hidden>
      {style === 'tiles' ? [area('a', 1), area('b', 1), area('c', 1), area('d', 1)] : [area('a', 3), area('b', 2)]}
    </span>
  )
}

/** Tiles or Tabs (ADR 0042), as two cards: in the welcome and in Settings › Appearance. */
export function PaneStylePicker({ value, onChange }: { value: PaneStyle; onChange: (style: PaneStyle) => void }) {
  return (
    <div className={styles.cards} role="radiogroup" aria-label="Pane style">
      {PANE_STYLES.map((style) => (
        <button key={style} type="button" role="radio" aria-checked={value === style} className={cx(styles.card, value === style && styles.on)} onClick={() => onChange(style)}>
          <Sketch style={style} />
          <span className={styles.name}>{LABEL[style].name}</span>
          <span className={styles.text}>{LABEL[style].text}</span>
        </button>
      ))}
    </div>
  )
}
