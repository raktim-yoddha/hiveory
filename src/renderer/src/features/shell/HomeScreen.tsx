import { FolderPlus } from 'lucide-react'
import { AppLogo } from '../../components/brand/AppLogo'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { useProjects } from '../../stores/data'
import { useAddProject } from '../projects/AddProjectDialog'
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
            : 'Add a project — a folder, a new repository or a clone — to run coding agents side by side.'
        }
        actions={
          <Button variant="primary" size="lg" icon={<FolderPlus />} onClick={() => useAddProject.getState().show()}>
            Add project
          </Button>
        }
      />
    </div>
  )
}
