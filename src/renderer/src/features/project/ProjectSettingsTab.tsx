import { useState } from 'react'
import type { Project } from '@shared/domain'
import { Button } from '../../components/ui/Button'
import { RemoveProjectDialog } from '../projects/RemoveProjectDialog'
import styles from './ProjectScreen.module.css'

export function ProjectSettingsTab({ project }: { project: Project }) {
  const [confirming, setConfirming] = useState(false)

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Workspace</h2>
      <dl className={styles.facts}>
        <dt>Folder</dt>
        <dd title={project.path}>{project.path}</dd>
        <dt>Repository</dt>
        <dd title={project.repositoryRoot}>{project.repositoryRoot ?? 'Not a Git repository'}</dd>
      </dl>
      <div className={styles.danger}>
        <div>
          <p>Remove from Hiveory</p>
          <p className={styles.muted}>Stops this workspace's agents. Files on disk are not touched.</p>
        </div>
        <Button variant="danger" onClick={() => setConfirming(true)}>
          Remove
        </Button>
      </div>
      {confirming && <RemoveProjectDialog project={project} onClose={() => setConfirming(false)} />}
    </div>
  )
}
