import { FolderOpen } from 'lucide-react'
import { AppLogo } from '../../components/brand/AppLogo'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { useProjects } from '../../stores/data'
import { openProjectFolder } from '../projects/project-actions'
import styles from './AppShell.module.css'

/** Shown when no project is selected. */
export function HomeScreen() {
  const hasProjects = useProjects((s) => s.projects.length > 0)

  return (
    <div className={styles.surface}>
      <EmptyState
        media={<AppLogo size="lg" />}
        title={hasProjects ? 'Select a project' : 'Welcome to Hiveory'}
        description={
          hasProjects
            ? 'Choose a project from the sidebar to see its agents and workspaces.'
            : 'Open a local project folder to run coding agents side by side.'
        }
        actions={
          <Button variant="primary" size="lg" icon={<FolderOpen />} onClick={() => void openProjectFolder()}>
            Open project
          </Button>
        }
      />
    </div>
  )
}
