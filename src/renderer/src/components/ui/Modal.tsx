import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { IconButton } from './Button'
import styles from './Modal.module.css'

interface ModalProps {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: 'md' | 'lg'
}

/** Native <dialog>: focus trapping, Escape and inert background come from the platform. */
export function Modal({ open, title, onClose, children, footer, width = 'md' }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      // showModal focuses the first control, the header's Close, so Enter would close the dialog. React's
      // autoFocus ran while the dialog was still closed; start instead on the control marked
      // data-autofocus, else the first field, else the footer's last (primary) button.
      const start =
        dialog.querySelector<HTMLElement>('[data-autofocus]') ??
        dialog.querySelector<HTMLElement>(`.${styles.body} :is(input, textarea, select):not([disabled])`) ??
        [...dialog.querySelectorAll<HTMLElement>(`.${styles.footer} button:not([disabled])`)].at(-1)
      start?.focus()
    }
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      data-width={width}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onMouseDown={(event) => {
        if (event.target === ref.current) onClose()
      }}
    >
      {open && (
        <div className={styles.content}>
          <header className={styles.header}>
            <h2 className={styles.title}>{title}</h2>
            <IconButton label="Close" icon={<X />} onClick={onClose} />
          </header>
          <div className={styles.body}>{children}</div>
          {footer && <footer className={styles.footer}>{footer}</footer>}
        </div>
      )}
    </dialog>
  )
}
