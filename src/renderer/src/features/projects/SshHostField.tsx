import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Server } from 'lucide-react'
import type { SshHostSuggestion } from '@shared/domain/tailnet'
import { TextField } from '../../components/ui/TextField'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import styles from './SshHostField.module.css'

/** Keeps a typed `user@` when a host is picked (the picker only knows hosts). */
const withUser = (current: string, destination: string): string => {
  const at = current.indexOf('@')
  return at > 0 && !destination.includes('@') ? `${current.slice(0, at + 1)}${destination}` : destination
}

interface SshHostFieldProps {
  value: string
  onChange: (value: string) => void
  label?: string
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void
  adornment?: ReactNode
}

/**
 * An SSH host, typed or picked (ADR 0025): the user's Tailscale devices and the
 * hosts in their ~/.ssh/config, like Orca's config picker. Picking fills the
 * field; anything else (user@host, an IP) can still be typed.
 */
export function SshHostField({ value, onChange, label = 'SSH host', onKeyDown, adornment }: SshHostFieldProps) {
  const [suggestions, setSuggestions] = useState<SshHostSuggestion[]>([])
  const [tailscale, setTailscale] = useState<string>('running')

  useEffect(() => {
    let alive = true
    void api('hosts.suggest')
      .then((s) => {
        if (!alive) return
        setSuggestions(s.hosts)
        setTailscale(s.tailscale)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  const host = value.slice(value.indexOf('@') + 1).trim().toLowerCase()
  const picked = suggestions.some((s) => s.destination.toLowerCase() === host)
  const shown = picked ? [] : suggestions.filter((s) => !host || s.destination.toLowerCase().includes(host) || s.label.toLowerCase().includes(host))

  return (
    <div className={styles.field}>
      <TextField label={label} value={value} placeholder="Pick below, or type devbox or me@build.example.com" onChange={onChange} onKeyDown={onKeyDown} adornment={adornment ?? <Server aria-hidden />} />
      {shown.length > 0 && (
        <ul className={styles.list} aria-label="Your SSH hosts and Tailscale devices">
          {shown.map((s) => (
            <li key={`${s.source}:${s.destination}`}>
              <button type="button" className={styles.item} onClick={() => onChange(withUser(value, s.destination))}>
                <span className={cx(styles.dot, s.online === true && styles.online, s.online === false && styles.offline)} aria-hidden />
                <span className={styles.name}>{s.label}</span>
                <span className={styles.meta}>{s.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!picked && suggestions.length === 0 && tailscale !== 'running' && (
        <span className={styles.hint}>Tip: with Tailscale on both computers, your devices show up here to pick.</span>
      )}
    </div>
  )
}
