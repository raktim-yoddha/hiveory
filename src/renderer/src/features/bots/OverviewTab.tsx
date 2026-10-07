import { useCallback, useEffect, useState } from 'react'
import type { ApprovalLevel } from '@shared/domain/approval'
import type { BotView } from '@shared/domain/bot'
import type { ExtensionsInventory } from '@shared/domain'
import { Select } from '../../components/ui/Select'
import { Toggle } from '../../components/ui/Toggle'
import { api } from '../../lib/api'
import { useBots } from '../../stores/bots'
import { useApp, useSettings } from '../../stores/data'
import { reportError } from '../../stores/notices'
import { useRoutines } from '../../stores/routines'
import { SkillsPanel } from '../settings/extensions/SkillsPanel'
import { botOverview } from './bot-overview'
import styles from './Bots.module.css'

const APPROVAL_OPTIONS: Array<{ value: ApprovalLevel; label: string }> = [
  { value: 'sends', label: 'Sending as you' },
  { value: 'changes', label: 'Any change' },
  { value: 'never', label: 'Never' }
]

/** Rough token count of a prompt (about four characters a token), for the preview's size line. */
const tokens = (text: string): number => Math.round(text.length / 4)

/** The bot at a glance: what it does, can reach and won't do, its prompt, notifications and its own skills. */
export function OverviewTab({ bot }: { bot: BotView }) {
  const { teams, bots, update } = useBots()
  const { routines, loaded, load } = useRoutines()
  const settings = useSettings((s) => s.settings)
  const platform = useApp((s) => s.info?.platform)
  const [prompt, setPrompt] = useState<string | null>(null)
  const [skills, setSkills] = useState<ExtensionsInventory | null>(null)

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  const scanSkills = useCallback(async () => {
    try {
      setSkills(await api('extensions.scan', { botId: bot.id }))
    } catch (error) {
      reportError(error, 'Load skills')
    }
  }, [bot.id])
  useEffect(() => {
    void scanSkills()
  }, [scanSkills])

  // The preview follows the bot: a changed brief, name or memory re-reads it.
  useEffect(() => {
    let alive = true
    void api('bots.preview', { botId: bot.id }).then(
      (text) => alive && setPrompt(text),
      () => undefined
    )
    return () => {
      alive = false
    }
  }, [bot.id, bot.updatedAt])

  const team = teams.find((t) => t.id === bot.teamId)
  const seatOn = bot.computer?.kind === 'shared' ? bots.find((b) => b.id === (bot.computer as { botId: string }).botId)?.name : undefined
  const o = botOverview(bot, {
    seatOn,
    teamName: team?.name ?? 'General',
    teamCount: teams.length,
    routines: routines.filter((r) => r.botId === bot.id),
    switches: { browser: settings.browserUse, computer: settings.computerUse && platform === 'win32' }
  })
  const section = (title: string, lines: string[]) => (
    <section className={styles.card} aria-label={title}>
      <h3 className={styles.cardTitle}>{title}</h3>
      <ul className={styles.facts}>
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  )

  return (
    <div className={styles.tabBody}>
      <section className={styles.card} aria-label={bot.name}>
        <h3 className={styles.cardTitle}>{bot.name}</h3>
        <p className={styles.switchHint}>{bot.blurb || bot.brief.split('\n')[0] || 'No brief yet. Edit the bot to say what it owns.'}</p>
      </section>
      {section('Does', o.does)}
      {section('Can reach', o.reach)}
      {section("Won't", o.wont)}
      <section className={styles.card} aria-label="Notifications">
        <div className={styles.switchRow}>
          <span className={styles.switchText}>
            <span className={styles.switchTitle}>Notifications</span>
            <span className={styles.switchHint}>When it replies or a routine of its ends while you are away from Hiveory.</span>
          </span>
          <Toggle label={`Notifications from ${bot.name}`} checked={bot.notify} onChange={(notify) => void update(bot.id, { notify })} />
        </div>
      </section>
      <section className={styles.card} aria-label="Approvals">
        <div className={styles.switchRow}>
          <span className={styles.switchText}>
            <span className={styles.switchTitle}>Asks before</span>
            <span className={styles.switchHint}>Its app and MCP actions wait for your yes, in its thread and on the work board. Reading is never asked.</span>
          </span>
          <Select
            label={`When ${bot.name} asks`}
            hideLabel
            value={bot.approvals}
            options={APPROVAL_OPTIONS}
            onChange={(v) => void update(bot.id, { approvals: v as ApprovalLevel })}
          />
        </div>
      </section>
      <details className={styles.card}>
        <summary className={styles.cardTitle}>
          Prompt preview{prompt !== null ? ` · ${new Blob([prompt]).size.toLocaleString()} bytes ≈ ${tokens(prompt).toLocaleString()} tokens` : ''}
        </summary>
        <pre className={styles.prompt}>{prompt ?? 'Loading…'}</pre>
      </details>
      <section className={styles.card} aria-label="Skills">
        <h3 className={styles.cardTitle}>Skills</h3>
        <p className={styles.switchHint}>Procedures it follows. Skills marked &ldquo;This bot&rdquo; live in its folder; the rest are yours, for every agent.</p>
        <SkillsPanel inventory={skills} botId={bot.id} onChanged={scanSkills} />
      </section>
    </div>
  )
}
