import { CalendarClock, Globe, MessageSquare } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { BOT_TEMPLATES, type BotTemplate } from './bot-templates'
import styles from './Bots.module.css'

/** Starter bots to begin from: picking one opens the bot editor filled in. */
export function TemplatesDialog({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (template: BotTemplate) => void }) {
  return (
    <Modal open={open} title="Templates" width="lg" onClose={onClose}>
      <p className={styles.switchHint}>Start from a bot that already knows its job. You can change everything before it is created.</p>
      <ul className={styles.templates}>
        {BOT_TEMPLATES.map((t) => (
          <li key={t.id}>
            <button type="button" className={styles.template} onClick={() => onPick(t)}>
              <span className={styles.choiceTitle}>{t.name}</span>
              <span className={styles.choiceHint}>{t.summary}</span>
              <span className={styles.templateTags}>
                {t.worksOn === 'browser' ? (
                  <span className={styles.templateTag}>
                    <Globe aria-hidden /> Browser
                  </span>
                ) : (
                  <span className={styles.templateTag}>
                    <MessageSquare aria-hidden /> Connected apps
                  </span>
                )}
                {t.routines && (
                  <span className={styles.templateTag}>
                    <CalendarClock aria-hidden /> Runs on a schedule
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  )
}
