import type { Project } from '@shared/domain'
import { Button } from '../../components/ui/Button'
import { api } from '../../lib/api'
import { useProjects } from '../../stores/data'
import { runAction } from '../../stores/notices'
import styles from './ProjectScreen.module.css'

/** Why Git is off in a Workspace inside a larger repository (ADR 0071). */
export const parentRepositoryText = (root: string): string =>
  `This folder is inside the Git repository at ${root}. Git stays off here until you choose: Commit, Push and Discard would act on that whole repository.`

/**
 * A Workspace inside a larger Git repository (ADR 0071), as VS Code asks: use that repository, or
 * give the folder a repository of its own. `onDone` runs once the choice is saved.
 */
export function ParentRepositoryChoice({ project, onDone }: { project: Project; onDone?: () => void }) {
  const update = useProjects((s) => s.update)
  const use = (): void => void update(project.id, { settings: { useParentRepository: true } }).then(() => onDone?.())
  const own = (): void =>
    void runAction('Initialize Git', () => api('git.init', { projectId: project.id, commit: true }))
      .then(() => useProjects.getState().load())
      .then(() => onDone?.())
  return (
    <span className={styles.actions}>
      <Button size="sm" onClick={use}>
        Use that repository
      </Button>
      <Button size="sm" variant="ghost" onClick={own}>
        Give this folder its own
      </Button>
    </span>
  )
}
