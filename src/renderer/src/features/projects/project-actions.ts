import { api } from '../../lib/api'
import { useProjects } from '../../stores/data'
import { useNavigation } from '../../stores/navigation'
import { runAction } from '../../stores/notices'

/** Shows the folder picker, registers the project and navigates to it. */
export const openProjectFolder = (): Promise<void> =>
  runAction('Open project', async () => {
    const project = await api('projects.open')
    if (!project) return
    await useProjects.getState().load()
    useNavigation.getState().openProject(project.id)
  })
