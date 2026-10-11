import { useState } from 'react'
import { Plus } from 'lucide-react'
import { IconButton } from '../../components/ui/Button'
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog'

/** The "+" for a new worktree: opens Create worktree, whose tabs pick new, existing or remote branch (ADR 0039). */
export function NewWorktreeButton({ projectId, label, className }: { projectId: string; label: string; className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <IconButton className={className} label={label} icon={<Plus />} onClick={() => setOpen(true)} />
      {open && <CreateWorkspaceDialog projectId={projectId} onClose={() => setOpen(false)} />}
    </>
  )
}
