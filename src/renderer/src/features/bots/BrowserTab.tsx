import { useState } from 'react'
import { Globe, Plus, X } from 'lucide-react'
import { botScope, type BotView } from '@shared/domain/bot'
import { botReach } from '@shared/domain/bot-reach'
import { Button, IconButton } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { api } from '../../lib/api'
import { useBrowser } from '../../stores/browser'
import { useSettings } from '../../stores/data'
import { runAction } from '../../stores/notices'
import { BrowserPane } from '../browser/BrowserPane'
import { pageTitle } from '../browser/page-title'
import styles from './Bots.module.css'

/**
 * The bot's browser: the pages all its threads share, in its own profile (its own logins). The user can open
 * a page here to sign in to a site for the bot, so no password ever goes into a chat.
 */
export function BrowserTab({ bot }: { bot: BotView }) {
  const scope = botScope(bot.id)
  const allPages = useBrowser((s) => s.pages)
  const pages = allPages.filter((p) => p.scope === scope)
  const settings = useSettings((s) => s.settings)
  const [chosen, setChosen] = useState<string | null>(null)
  const current = pages.find((p) => p.id === chosen) ?? pages[0]
  const usable = botReach(bot, { browser: settings.browserUse, computer: false }).includes('browser')

  const open = async (): Promise<void> => {
    const page = await runAction('Open browser', () => api('browser.open', { scope, url: settings.browserHomeUrl || undefined }))
    if (page) setChosen(page.id)
  }
  const close = (pageId: string): void => void api('browser.close', { pageId }).catch(() => undefined)

  return (
    <div className={styles.browserTab}>
      {!usable && (
        <p className={styles.browserNote}>
          {settings.browserUse ? `${bot.name} doesn't use the browser with its current Works on choice.` : 'Browser use is off in Settings.'} You can still
          sign in to sites for it here.
        </p>
      )}
      <div className={styles.threads} role="tablist" aria-label={`${bot.name}'s pages`}>
        {pages.map((p) => (
          <span key={p.id} className={styles.pageTab}>
            <button type="button" role="tab" aria-selected={p.id === current?.id} className={styles.threadTab} title={p.url} onClick={() => setChosen(p.id)}>
              <span className={styles.threadTitle}>{pageTitle(p)}</span>
            </button>
            <IconButton label={`Close ${pageTitle(p)}`} icon={<X />} size="sm" onClick={() => close(p.id)} />
          </span>
        ))}
        <IconButton label="Open a page" icon={<Plus />} onClick={() => void open()} />
      </div>
      {current ? (
        <div className={styles.browserBody}>
          <BrowserPane pageId={current.id} visible />
        </div>
      ) : (
        <EmptyState
          compact
          icon={<Globe />}
          title="No pages yet"
          description={`Pages ${bot.name} opens show here. Open one to sign in to a site for it: its logins stay apart from yours.`}
          actions={
            <Button variant="primary" icon={<Plus />} onClick={() => void open()}>
              Open a page
            </Button>
          }
        />
      )}
    </div>
  )
}
