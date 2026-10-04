import { useState } from 'react'
import type { Project } from '@shared/domain'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { api } from '../../lib/api'
import { useNavigation } from '../../stores/navigation'
import { runAction } from '../../stores/notices'
import styles from './ProjectScreen.module.css'

export function ProjectSettingsTab({ project }: { project: Project }) {
  const goHome = useNavigation((s) => s.goHome)
  const [confirming, setConfirming] = useState(false)

  const remove = (): void =>
    void runAction('Remove project', async () => {
      await api('projects.remove', { projectId: project.id })
      setConfirming(false)
      goHome()
    })

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Project</h2>
      <dl className={styles.facts}>
        <dt>Folder</dt>
        <dd title={project.path}>{project.path}</dd>
        <dt>Repository</dt>
        <dd title={project.repositoryRoot}>{project.repositoryRoot ?? 'Not a Git repository'}</dd>
      </dl>
      <div className={styles.danger}>
        <div>
          <p>Remove from Hiveory</p>
          <p className={styles.muted}>Stops this project's agents. Files on disk are not touched.</p>
        </div>
        <Button variant="danger" onClick={() => setConfirming(true)}>
          Remove
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        danger
        title={`Remove ${project.name}?`}
        confirmLabel="Remove project"
        onConfirm={remove}
        onClose={() => setConfirming(false)}
      >
        <p>Its agents will stop and it will disappear from the sidebar. Nothing is deleted from disk.</p>
      </ConfirmDialog>
    </div>
  )
}
