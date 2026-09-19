import { type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'

type ButtonIntent = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'standard' | 'compact' | 'icon'

function classes(...values: Array<string | false | null | undefined>) { return values.filter(Boolean).join(' ') }

export function HiveoryButton({ intent = 'secondary', size = 'standard', className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { intent?: ButtonIntent; size?: ButtonSize }) {
  return <button {...props} className={classes('hiveory-button', `hiveory-button--${intent}`, `hiveory-button--${size}`, className)}>{children}</button>
}

export function HiveoryIconButton({ className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <HiveoryButton {...props} size="icon" className={classes('hiveory-icon-button', className)}>{children}</HiveoryButton>
}

export function HiveoryPageHeader({ id, title, subtitle, actions, className }: { id: string; title: string; subtitle?: ReactNode; actions?: ReactNode; className?: string }) {
  return <header className={classes('hiveory-page-header', className)}><div className="hiveory-page-heading"><h1 id={id} className="hiveory-page-title">{title}</h1>{subtitle && <p className="hiveory-page-subtitle">{subtitle}</p>}</div>{actions && <div className="hiveory-page-actions">{actions}</div>}</header>
}

export function HiveorySurface({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={classes('hiveory-surface', className)}>{children}</section>
}

export function HiveorySearchField({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} type="search" className={classes('hiveory-search-field', className)} />
}

export function HiveoryTabs<T extends string>({ label, value, tabs, onChange }: { label: string; value: T; tabs: Array<{ value: T; label: string }>; onChange: (value: T) => void }) {
  return <div className="hiveory-tabs" role="tablist" aria-label={label}>{tabs.map((tab) => <HiveoryButton key={tab.value} type="button" role="tab" size="compact" intent="ghost" className={value === tab.value ? 'is-selected' : ''} aria-selected={value === tab.value} tabIndex={value === tab.value ? 0 : -1} onClick={() => onChange(tab.value)}>{tab.label}</HiveoryButton>)}</div>
}

export function HiveoryBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'success' | 'warning' | 'danger' }) {
  return <span className={`hiveory-badge hiveory-badge--${tone}`}>{children}</span>
}

export function HiveoryEmptyState({ title, children, action, className }: { title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return <section className={classes('hiveory-empty-state', className)}><strong>{title}</strong>{children && <p>{children}</p>}{action}</section>
}

export function HiveoryLoadingState({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return <div className={classes('hiveory-loading-state', className)} role="status" aria-live="polite"><span className="hiveory-loading-spinner" aria-hidden="true" />{label}</div>
}

export function HiveoryDialog({ title, open, onClose, children, actions }: { title: string; open: boolean; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  const titleId = useId()
  const dialogRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!open) return undefined
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, open])
  useEffect(() => {
    if (open) dialogRef.current?.querySelector<HTMLElement>('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')?.focus()
  }, [open])
  if (!open) return null
  return <><div className="hiveory-dialog-backdrop" aria-hidden="true" onMouseDown={onClose} /><section ref={dialogRef} className="hiveory-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}><header className="hiveory-dialog__header"><h2 id={titleId}>{title}</h2><HiveoryIconButton type="button" onClick={onClose} aria-label="Close dialog"><X size={16} aria-hidden="true" /></HiveoryIconButton></header><div className="hiveory-dialog__body">{children}</div>{actions && <footer className="hiveory-dialog__actions">{actions}</footer>}</section></>
}
