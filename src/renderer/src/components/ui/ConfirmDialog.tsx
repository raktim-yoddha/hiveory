import type { ReactNode } from 'react'
import { Button } from './Button'
import { Modal } from './Modal'

interface ConfirmDialogProps {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
}

export function ConfirmDialog({ open, title, children, confirmLabel, danger, busy, onConfirm, onClose }: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={busy} autoFocus>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  )
}
