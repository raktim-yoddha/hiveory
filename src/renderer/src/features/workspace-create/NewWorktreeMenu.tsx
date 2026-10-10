import { useState, type ReactNode } from 'react'
import { CloudDownload, GitBranch, GitBranchPlus } from 'lucide-react'
import { Menu, type MenuTriggerProps } from '../../components/ui/Menu'
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog'
import type { WorktreeSource } from './GitOptions'

/** The one "new worktree" menu: a new branch, an existing one, or one on the remote (ADR 0038). */
export function NewWorktreeMenu({ projectId, trigger }: { projectId: string; trigger: (props: MenuTriggerProps) => ReactNode }) {
  const [source, setSource] = useState<WorktreeSource | null>(null)
  return (
    <>
      <Menu
        label="New worktree"
        align="end"
        items={[
          { type: 'item', id: 'new', label: 'New branch', icon: <GitBranchPlus />, onSelect: () => setSource('new') },
          { type: 'item', id: 'existing', label: 'Existing branch', icon: <GitBranch />, onSelect: () => setSource('existing') },
          { type: 'item', id: 'remote', label: 'Remote branch', hint: 'GitHub', icon: <CloudDownload />, onSelect: () => setSource('remote') }
        ]}
        trigger={trigger}
      />
      {source && <CreateWorkspaceDialog projectId={projectId} source={source} onClose={() => setSource(null)} />}
    </>
  )
}
