import { useEffect, useMemo, useState } from 'react'
import { ArrowUpDown, Check, FolderPlus } from 'lucide-react'
import type { ProjectSort } from '@shared/domain'
import { IconButton } from '../../components/ui/Button'
import { Menu } from '../../components/ui/Menu'
import { useProjects } from '../../stores/data'
import { openProjectFolder } from './project-actions'
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
        sort === 'name' ? a.name.localeCompare(b.name) : b.lastOpenedAt.localeCompare(a.lastOpenedAt)
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

  const addProject = (): void => void openProjectFolder()

  return (
    <nav className={styles.sidebar} aria-label="Projects">
      <div className={styles.header}>
        <h2 className={styles.heading}>Projects</h2>
        <Menu
          label="Sort projects"
          align="end"
          items={(['recent', 'name'] as const).map((value) => ({
            type: 'item' as const,
            id: value,
            label: value === 'recent' ? 'Recently opened' : 'Name',
            icon: sort === value ? <Check /> : null,
            onSelect: () => chooseSort(value)
          }))}
          trigger={(props) => <IconButton {...props} label="Sort projects" icon={<ArrowUpDown />} />}
        />
        <IconButton label="Open project" icon={<FolderPlus />} onClick={addProject} />
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
          <p>No projects yet.</p>
          <button type="button" className={styles.link} onClick={addProject}>
            Open a folder
          </button>
        </div>
      )}
    </nav>
  )
}
