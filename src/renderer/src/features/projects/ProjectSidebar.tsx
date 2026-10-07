import { useEffect, useMemo, useState } from 'react'
import { Check, FolderPlus, ListFilter } from 'lucide-react'
import type { ProjectSort } from '@shared/domain'
import { IconButton } from '../../components/ui/Button'
import { Menu } from '../../components/ui/Menu'
import { useProjects } from '../../stores/data'
import { useAddProject } from './AddProjectDialog'
import { ProjectRow } from './ProjectRow'
import styles from './ProjectSidebar.module.css'

const SORT_KEY = 'hiveory.projectSort'

const readSort = (): ProjectSort => {
  try {
    return localStorage.getItem(SORT_KEY) === 'name' ? 'name' : 'recent'
  } catch {
    return 'recent'
  }
}

/** The single Projects sidebar of Workspace mode (design.md "Sidebar"). */
export function ProjectSidebar() {
  const { projects, loaded, load } = useProjects()
  const [sort, setSort] = useState<ProjectSort>(readSort)

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  const sorted = useMemo(
    () =>
      [...projects].sort((a, b) =>
        // Recent = last real work (ADR 0024): opening a project does not move it.
        sort === 'name' ? a.name.localeCompare(b.name) : (b.lastActiveAt ?? b.createdAt).localeCompare(a.lastActiveAt ?? a.createdAt)
      ),
    [projects, sort]
  )

  const chooseSort = (next: ProjectSort): void => {
    setSort(next)
    try {
      localStorage.setItem(SORT_KEY, next)
    } catch {
      // Sorting still works for this session without storage.
    }
  }

  const addProject = (): void => useAddProject.getState().show()

  return (
    <nav className={styles.sidebar} aria-label="Workspaces">
      <div className={styles.header}>
        <h2 className={styles.heading}>Workspaces</h2>
        <Menu
          label="Sort workspaces"
          align="end"
          items={(['recent', 'name'] as const).map((value) => ({
            type: 'item' as const,
            id: value,
            label: value === 'recent' ? 'Recent activity' : 'Name',
            icon: sort === value ? <Check /> : null,
            onSelect: () => chooseSort(value)
          }))}
          trigger={(props) => <IconButton {...props} label="Sort workspaces" icon={<ListFilter />} />}
        />
        <IconButton label="Add workspace" icon={<FolderPlus />} onClick={addProject} />
      </div>
      {projects.length > 0 && (
        <ul className={styles.list}>
          {sorted.map((project) => (
            <ProjectRow key={project.id} project={project} />
          ))}
        </ul>
      )}
      {loaded && projects.length === 0 && (
        <div className={styles.empty}>
          <p>No workspaces yet.</p>
          <button type="button" className={styles.link} onClick={addProject}>
            Add a workspace
          </button>
        </div>
      )}
    </nav>
  )
}
