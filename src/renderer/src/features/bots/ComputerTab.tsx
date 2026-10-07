import { useEffect, useState, type ReactNode } from 'react'
import { Box, Globe, Monitor, MonitorPlay, Play, Power, Server, Sparkles, Square } from 'lucide-react'
import type { BotComputerStatus, BotView, WorksOn } from '@shared/domain/bot'
import { botReach, type ReachFamily } from '@shared/domain/bot-reach'
import { Button } from '../../components/ui/Button'
import { cx } from '../../lib/cx'
import { api } from '../../lib/api'
import { useBots } from '../../stores/bots'
import { useApp, useSettings } from '../../stores/data'
import { useNavigation } from '../../stores/navigation'
import { runAction } from '../../stores/notices'
import { SshHostField } from '../projects/SshHostField'
import styles from './Bots.module.css'

/** The cards: "container" is split by where its Linux computer runs. */
type Choice = Exclude<WorksOn, 'container'> | 'local' | 'server'

const CHOICES: Array<{
  id: Choice
  title: string
  hint: string
  icon: ReactNode
}> = [
  {
    id: 'auto',
    title: 'Auto',
    hint: 'The browser, plus its Linux computer when one is set up',
    icon: <Sparkles aria-hidden />
  },
  {
    id: 'local',
    title: 'Linux computer',
    hint: 'A private desktop in Docker on this computer',
    icon: <Box aria-hidden />
  },
  {
    id: 'server',
    title: 'Server computer',
    hint: 'A private desktop in Docker on an SSH host',
    icon: <Server aria-hidden />
  },
  {
    id: 'this-computer',
    title: 'This computer',
    hint: 'Your screen and apps',
    icon: <Monitor aria-hidden />
  },
  {
    id: 'browser',
    title: 'Browser',
    hint: 'Web pages only',
    icon: <Globe aria-hidden />
  },
  {
    id: 'off',
    title: 'Off',
    hint: 'No computer access',
    icon: <Power aria-hidden />
  }
]

const choiceOf = (bot: BotView): Choice => (bot.worksOn === 'container' ? (bot.computer?.host ? 'server' : 'local') : bot.worksOn)

const NAMES: Record<ReachFamily, string> = {
  browser: 'the built-in browser',
  desktop: 'its Linux computer',
  computer: 'your screen and apps'
}
const listOf = (items: string[]): string => (items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`)

const STATE: Record<BotComputerStatus['state'], string> = {
  off: 'No computer',
  unavailable: 'Unavailable',
  missing: 'Starts on first use',
  stopped: 'Stopped',
  running: 'Running'
}

const SCREEN_POLL_MS = 2000

/** The bot panel's Computer tab: its Linux computer's screen and controls, and where it may work ("Works on"). */
export function ComputerTab({ bot }: { bot: BotView }) {
  const update = useBots((s) => s.update)
  const settings = useSettings((s) => s.settings)
  const platform = useApp((s) => s.info?.platform)
  const openSettings = useNavigation((s) => s.openSettings)
  const [picking, setPicking] = useState(false)
  const [host, setHost] = useState(bot.computer?.host?.destination ?? '')

  const switches = {
    browser: settings.browserUse,
    computer: settings.computerUse && platform === 'win32'
  }
  const reach = botReach(bot, switches)
  const selected: Choice = picking ? 'server' : choiceOf(bot)

  const choose = (choice: Choice): void => {
    if (choice === 'server') {
      setPicking(true)
      return
    }
    setPicking(false)
    if (choice === 'local')
      void update(bot.id, {
        worksOn: 'container',
        computer: { kind: 'docker' }
      })
    else void update(bot.id, { worksOn: choice })
  }
  const saveHost = (): void => {
    setPicking(false)
    void update(bot.id, {
      worksOn: 'container',
      computer: {
        kind: 'docker',
        host: { kind: 'ssh', destination: host.trim() }
      }
    })
  }

  const canSave = host.trim() !== '' && host.trim() !== bot.computer?.host?.destination
  const wantsBrowser = bot.worksOn === 'auto' || bot.worksOn === 'browser'
  return (
    <div className={styles.tabBody}>
      {reach.includes('desktop') ? (
        <ComputerScreen bot={bot} />
      ) : (
        <p className={styles.switchHint}>
          {bot.worksOn === 'this-computer'
            ? `${bot.name} works on your screen and apps when a task needs them.`
            : bot.worksOn === 'browser'
              ? `${bot.name} opens web pages in the built-in browser.`
              : bot.worksOn === 'off'
                ? `${bot.name} chats and uses connected apps, with no computer.`
                : `${bot.name} uses the built-in browser. Set up a Linux computer to give it a desktop of its own.`}
        </p>
      )}

      <section className={styles.card} aria-labelledby={`works-on-${bot.id}`}>
        <h3 id={`works-on-${bot.id}`} className={styles.cardTitle}>
          Works on
        </h3>
        <p className={styles.switchHint}>Choose where {bot.name} can use a computer.</p>
        <div className={styles.choices} role="radiogroup" aria-labelledby={`works-on-${bot.id}`}>
          {CHOICES.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={selected === c.id}
              className={cx(styles.choice, selected === c.id && styles.choiceOn)}
              onClick={() => choose(c.id)}
            >
              <span className={styles.choiceTitle}>
                {c.icon}
                {c.title}
              </span>
              <span className={styles.choiceHint}>{c.hint}</span>
            </button>
          ))}
        </div>
        {selected === 'server' && (
          <div className={styles.hostRow}>
            <SshHostField
              label="SSH host for its computer"
              value={host}
              onChange={setHost}
              onKeyDown={(e) => e.key === 'Enter' && canSave && saveHost()}
              adornment={
                <Button variant="primary" icon={<Server />} onClick={saveHost} disabled={!canSave}>
                  Use this host
                </Button>
              }
            />
            <span className={styles.switchHint}>Docker on that machine is root-equivalent there: use a machine dedicated to bots.</span>
          </div>
        )}
        <p className={styles.reach}>
          {reach.length ? `Can use ${listOf(reach.map((f) => NAMES[f]))} now.` : bot.worksOn === 'off' ? 'Chat and connected apps only.' : 'Nothing yet: see below.'}
        </p>
        {wantsBrowser && !switches.browser && (
          <p className={styles.blocked}>
            Browser use is off in Settings.
            <Button variant="ghost" size="sm" onClick={() => openSettings('browser')}>
              Open settings
            </Button>
          </p>
        )}
        {bot.worksOn === 'this-computer' && !switches.computer && (
          <p className={styles.blocked}>
            {platform && platform !== 'win32' ? 'Using your screen works on Windows for now.' : 'Computer use is off in Settings.'}
            {platform === 'win32' && (
              <Button variant="ghost" size="sm" onClick={() => openSettings('agents')}>
                Open settings
              </Button>
            )}
          </p>
        )}
      </section>
    </div>
  )
}

/** Its Linux computer: state, start/stop, take control, and a live screenshot while it runs and the tab is shown. */
function ComputerScreen({ bot }: { bot: BotView }) {
  const [status, setStatus] = useState<BotComputerStatus | null>(null)
  const [screen, setScreen] = useState<string | null>(null)
  const where = bot.computer?.host ? bot.computer.host.destination : 'this computer'

  const act = async (action: 'status' | 'start' | 'stop' | 'takeControl', label: string): Promise<void> => {
    const next = await runAction(label, () => api('bots.computer', { botId: bot.id, action }))
    if (next) setStatus(next)
  }

  useEffect(() => {
    let alive = true
    void api('bots.computer', { botId: bot.id, action: 'status' })
      .then((s) => alive && setStatus(s))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [bot.id, bot.computer?.host?.destination])

  const running = status?.state === 'running'
  useEffect(() => {
    if (!running) return
    let alive = true
    const tick = (): void => {
      if (document.hidden) return
      void api('bots.screen', { botId: bot.id })
        .then((png) => alive && setScreen(png))
        .catch(() => undefined)
    }
    tick()
    const timer = setInterval(tick, SCREEN_POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [running, bot.id])

  return (
    <section className={styles.screenBlock} aria-label={`${bot.name}'s screen`}>
      <div className={styles.screenHead}>
        <span className={styles.cardTitle}>{bot.name}&rsquo;s screen</span>
        <span className={styles.switchHint}>
          {status ? STATE[status.state] : 'Checking…'} · {where}
        </span>
      </div>
      <div className={styles.screen}>
        {running && screen ? (
          <img className={styles.screenImage} src={`data:image/png;base64,${screen}`} alt={`${bot.name}'s desktop`} />
        ) : (
          <span className={styles.switchHint}>{status?.detail ?? (running ? 'Capturing the screen…' : 'The desktop shows here while it runs.')}</span>
        )}
      </div>
      <div className={styles.rowEnd}>
        {running ? (
          <Button variant="ghost" icon={<Square />} onClick={() => void act('stop', 'Stop the computer')}>
            Stop
          </Button>
        ) : (
          <Button variant="ghost" icon={<Play />} onClick={() => void act('start', 'Start the computer')} disabled={status?.state === 'unavailable'}>
            Start
          </Button>
        )}
        <Button variant="secondary" icon={<MonitorPlay />} onClick={() => void act('takeControl', 'Open the desktop')} disabled={!running}>
          Take control
        </Button>
      </div>
    </section>
  )
}
