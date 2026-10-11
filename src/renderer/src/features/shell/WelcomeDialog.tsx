import { useState } from 'react'
import type { PaneStyle } from '@shared/domain'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { useSettings } from '../../stores/data'
import { PaneStylePicker } from '../settings/PaneStylePicker'
import styles from '../settings/Settings.module.css'

/**
 * The first-run welcome (ADR 0042): how panes are laid out, Tiles or Tabs. Shown once, until it is
 * answered; Settings › Appearance › Pane style changes it any time.
 */
export function WelcomeDialog() {
  const loaded = useSettings((s) => s.loaded)
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  const [style, setStyle] = useState<PaneStyle>(settings.paneStyle)
  if (!loaded || settings.welcomed) return null

  const finish = (): void => void update({ paneStyle: style, welcomed: true })
  return (
    <Modal
      open
      title="Welcome to Hiveory"
      width="lg"
      onClose={finish}
      footer={
        <Button variant="primary" onClick={finish}>
          Start
        </Button>
      }
    >
      <p className={styles.groupNote}>How should your agents, terminals and pages sit side by side? You can change this later in Settings › Appearance.</p>
      <PaneStylePicker value={style} onChange={setStyle} />
    </Modal>
  )
}
