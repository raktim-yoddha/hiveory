import { createContext, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, useCallback, useContext, useEffect, useId, useRef, useState } from 'react'
import { X } from 'lucide-react'

type ButtonIntent = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'standard' | 'compact' | 'icon'
type DialogSize = 'narrow' | 'standard'

function classes(...values: Array<string | false | null | undefined>) { return values.filter(Boolean).join(' ') }
function focusableElements(element: HTMLElement | null) {
  if (!element) return [] as HTMLElement[]
  return Array.from(element.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((item) => !item.hasAttribute('hidden'))
}

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

export function HiveorySelect({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={classes('hiveory-select', className)}>{children}</select>
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

export function HiveoryDialog({ title, description, open, onClose, children, actions, size = 'standard', closeDisabled = false }: { title: string; description?: ReactNode; open: boolean; onClose: () => void; children: ReactNode; actions?: ReactNode; size?: DialogSize; closeDisabled?: boolean }) {
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)
  const dismiss = useCallback(() => { if (!closeDisabled) onClose() }, [closeDisabled, onClose])
  useEffect(() => {
    if (!open) return undefined
    previouslyFocused.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusFirst = () => { const focusables = focusableElements(dialogRef.current); (focusables[0] ?? dialogRef.current)?.focus() }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); dismiss(); return }
      if (event.key !== 'Tab') return
      const focusables = focusableElements(dialogRef.current)
      if (!focusables.length) { event.preventDefault(); dialogRef.current?.focus(); return }
      const first = focusables[0]; const last = focusables[focusables.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', handleKeyDown)
    window.setTimeout(focusFirst, 0)
    return () => { window.removeEventListener('keydown', handleKeyDown); previouslyFocused.current?.focus() }
  }, [dismiss, open])
  if (!open) return null
  return <><div className="hiveory-dialog-backdrop" aria-hidden="true" onMouseDown={dismiss} /><section ref={dialogRef} className={classes('hiveory-dialog', `hiveory-dialog--${size}`)} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} tabIndex={-1}><header className="hiveory-dialog__header"><h2 id={titleId}>{title}</h2><HiveoryIconButton type="button" onClick={dismiss} disabled={closeDisabled} aria-label="Close dialog"><X size={16} aria-hidden="true" /></HiveoryIconButton></header>{description && <p id={descriptionId} className="hiveory-dialog__description">{description}</p>}<div className="hiveory-dialog__body">{children}</div>{actions && <footer className="hiveory-dialog__actions">{actions}</footer>}</section></>
}

export function useHiveoryDismissibleLayer(open: boolean, onDismiss: () => void) {
  const layerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return undefined
    const dismissPointer = (event: PointerEvent) => { if (layerRef.current && !layerRef.current.contains(event.target as Node)) onDismiss() }
    const dismissEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onDismiss() }
    window.addEventListener('pointerdown', dismissPointer)
    window.addEventListener('keydown', dismissEscape)
    return () => { window.removeEventListener('pointerdown', dismissPointer); window.removeEventListener('keydown', dismissEscape) }
  }, [onDismiss, open])
  return layerRef
}

export function HiveoryMenu({ children, className, onClose, label }: { children: ReactNode; className?: string; onClose: () => void; label?: string }) {
  const moveFocus = (current: HTMLElement, direction: 1 | -1) => {
    const items = Array.from(current.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'))
    if (!items.length) return
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    items[(index + direction + items.length) % items.length]?.focus()
  }
  return <div className={classes('hiveory-menu', className)} role="menu" aria-label={label} onKeyDown={(event) => {
    const current = event.currentTarget
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
    if (event.key === 'ArrowDown') { event.preventDefault(); moveFocus(current, 1); return }
    if (event.key === 'ArrowUp') { event.preventDefault(); moveFocus(current, -1); return }
    const items = Array.from(current.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'))
    if (event.key === 'Home') { event.preventDefault(); items[0]?.focus() }
    if (event.key === 'End') { event.preventDefault(); items.at(-1)?.focus() }
  }}>{children}</div>
}

export function HiveoryMenuItem({ className, intent = 'ghost', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { intent?: ButtonIntent }) {
  return <HiveoryButton {...props} type="button" role="menuitem" intent={intent} size="compact" className={classes('hiveory-menu-item', className)} />
}

type ConfirmOptions = { title: string; description?: ReactNode; confirmLabel?: string; intent?: Extract<ButtonIntent, 'primary' | 'danger'> }
type PromptOptions = ConfirmOptions & { label: string; submitLabel?: string; initialValue?: string; placeholder?: string; validate?: (value: string) => string | null }
type PendingDialog = { kind: 'confirm'; options: ConfirmOptions } | { kind: 'prompt'; options: PromptOptions }
type DialogService = { confirm: (options: ConfirmOptions) => Promise<boolean>; prompt: (options: PromptOptions) => Promise<string | null> }
const DialogContext = createContext<DialogService | null>(null)

export function HiveoryDialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingDialog | null>(null)
  const [value, setValue] = useState('')
  const [validation, setValidation] = useState<string | null>(null)
  const resolver = useRef<((result: boolean | string | null) => void) | null>(null)
  const settle = useCallback((result: boolean | string | null) => { resolver.current?.(result); resolver.current = null; setPending(null); setValue(''); setValidation(null) }, [])
  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => { resolver.current = (result) => resolve(result === true); setPending({ kind: 'confirm', options }) }), [])
  const prompt = useCallback((options: PromptOptions) => new Promise<string | null>((resolve) => { resolver.current = (result) => resolve(typeof result === 'string' ? result : null); setValue(options.initialValue ?? ''); setPending({ kind: 'prompt', options }) }), [])
  const submitPrompt = () => {
    if (!pending || pending.kind !== 'prompt') return
    const nextValue = value.trim(); const message = pending.options.validate?.(nextValue) ?? null
    if (message) { setValidation(message); return }
    settle(nextValue)
  }
  return <DialogContext.Provider value={{ confirm, prompt }}>{children}{pending && <HiveoryDialog title={pending.options.title} description={pending.options.description} open onClose={() => settle(pending.kind === 'confirm' ? false : null)} size="narrow" actions={<><HiveoryButton type="button" intent="secondary" onClick={() => settle(pending.kind === 'confirm' ? false : null)}>Cancel</HiveoryButton><HiveoryButton type="button" intent={pending.options.intent ?? 'primary'} onClick={pending.kind === 'confirm' ? () => settle(true) : submitPrompt}>{pending.kind === 'prompt' ? pending.options.submitLabel ?? pending.options.confirmLabel ?? 'Confirm' : pending.options.confirmLabel ?? 'Confirm'}</HiveoryButton></>}><>{pending.kind === 'prompt' && <label className="hiveory-dialog-prompt-field">{pending.options.label}<input autoFocus value={value} placeholder={pending.options.placeholder} onChange={(event) => { setValue(event.target.value); setValidation(null) }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submitPrompt() } }} />{validation && <small role="alert">{validation}</small>}</label>}</></HiveoryDialog>}</DialogContext.Provider>
}

export function useHiveoryDialogs() {
  const dialogs = useContext(DialogContext)
  if (!dialogs) throw new Error('useHiveoryDialogs must be used inside HiveoryDialogProvider.')
  return dialogs
}
