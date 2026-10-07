import { useEffect, useRef } from 'react'
import { Bot as BotIcon, Monitor, Plus, Settings2, Trash2 } from 'lucide-react'
import { BotAvatar } from '../../components/brand/BotAvatar'
import { Button, IconButton } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Menu } from '../../components/ui/Menu'
import { StatusDot } from '../../components/ui/StatusDot'
import { useBots } from '../../stores/bots'
import { useChat } from '../../stores/chat'
import { useClis } from '../../stores/data'
import { ChatComposer } from '../chat/ChatComposer'
import { ChatMessages } from '../chat/ChatMessages'
import { RoutineEditor } from '../routines/RoutineEditor'
import { RoutinesPage } from '../routines/RoutinesPage'
import { BotEditor, useBotEditor } from './BotEditor'
import { TeamMapPage } from './TeamMapPage'
import chat from '../chat/Chat.module.css'
import styles from './Bots.module.css'

const EMPTY: never[] = []

/**
 * Bots mode (ADR 0022): one teammate at a time — its identity, its threads as
 * tabs, and the conversation. Threads run in main, so they keep working while
 * the user is in Work or Chat.
 */
export function BotsScreen() {
  const { bots, activeBotId, load, newThread, openThread, panelOpen, setPanelOpen, page } = useBots()
  /** undefined until loaded, so "no threads yet" is never confused with "not loaded yet". */
  const loadedThreads = useBots((s) => (activeBotId ? s.threads[activeBotId] : undefined))
  const threads = loadedThreads ?? EMPTY
  const starting = useRef(new Set<string>())
  const threadId = useBots((s) => (activeBotId ? s.activeThread[activeBotId] : undefined))
  const thread = useChat((s) => (threadId ? s.chats[threadId] : undefined))
  const removeThread = useChat((s) => s.remove)
  const openEditor = useBotEditor((s) => s.open)
  const bot = bots.find((b) => b.id === activeBotId)
  const cliName = useClis((s) => s.clis.find((c) => c.id === (thread?.cliId ?? bot?.cliId))?.displayName)

  useEffect(() => {
    void load()
  }, [load])

  // A bot always has a thread to type into: its first one is created when it is opened.
  useEffect(() => {
    if (!activeBotId || loadedThreads?.length !== 0 || starting.current.has(activeBotId)) return
    starting.current.add(activeBotId)
    void newThread(activeBotId).finally(() => starting.current.delete(activeBotId))
  }, [activeBotId, loadedThreads, newThread])

  if (page === 'team-map') {
    return (
      <>
        <TeamMapPage />
        <BotEditor />
      </>
    )
  }

  if (page === 'routines') {
    return (
      <>
        <RoutinesPage />
        <RoutineEditor />
      </>
    )
  }

  if (!bot) {
    return (
      <div className={chat.surface}>
        <EmptyState
          icon={<BotIcon />}
          title="Build your team of bots"
          description="Each bot is a teammate with its own brief, memory and conversations, on the engine you choose. The first one leads the team as Chief of Staff."
          actions={
            <Button variant="primary" size="lg" icon={<Plus />} onClick={() => openEditor('new')}>
              New bot
            </Button>
          }
        />
        <BotEditor />
      </div>
    )
  }

  return (
    <section className={chat.surface} aria-label={bot.name}>
      <header className={chat.chatHeader}>
        <BotAvatar id={bot.id} name={bot.name} />
        <div className={chat.headerText}>
          <h1 className={chat.chatHeading}>{bot.name}</h1>
          <span className={chat.headerMeta}>
            {bot.chief ? 'Chief of Staff · ' : ''}
            {cliName ? `Powered by ${cliName}` : 'No engine yet: choose one in its settings'}
          </span>
        </div>
        <StatusDot status={bot.running > 0 ? 'working' : 'idle'} detail={bot.running > 0 ? `${bot.running} working` : 'Ready'} />
        <IconButton label="Computer and browser" icon={<Monitor />} active={panelOpen} aria-pressed={panelOpen} onClick={() => setPanelOpen(!panelOpen)} />
        <IconButton label={`Edit ${bot.name}`} icon={<Settings2 />} onClick={() => openEditor(bot.id)} />
      </header>
      <div className={styles.threads} role="tablist" aria-label={`${bot.name} threads`}>
        {threads.map((t) => (
          <Menu
            key={t.id}
            context
            label={`${t.title} actions`}
            items={[
              {
                type: 'item',
                id: 'delete',
                label: 'Delete thread',
                icon: <Trash2 />,
                danger: true,
                onSelect: () => void removeThread(t.id).then(() => useBots.getState().select(bot.id))
              }
            ]}
            trigger={(props) => (
              <button
                {...props}
                type="button"
                role="tab"
                aria-selected={t.id === threadId}
                className={styles.threadTab}
                title={t.title}
                onClick={() => void openThread(bot.id, t.id)}
              >
                {t.running && <StatusDot status="working" />}
                <span className={styles.threadTitle}>{t.title}</span>
              </button>
            )}
          />
        ))}
        <IconButton label="New thread" icon={<Plus />} onClick={() => void newThread(bot.id)} />
      </div>
      {thread ? (
        <>
          <ChatMessages
            chat={thread}
            welcome={{
              title: 'What should we work on?',
              text: thread.delegation
                ? 'Another bot opened this thread to hand over work.'
                : `Give ${bot.name} a task. It keeps its brief and memory in every thread.`
            }}
          />
          <ChatComposer chat={thread} folder={false} placeholder={`Message ${bot.name}…`} />
        </>
      ) : (
        <EmptyState compact title="No thread open" description="Start a thread to give this bot a task." />
      )}
      <BotEditor />
      <RoutineEditor />
    </section>
  )
}
