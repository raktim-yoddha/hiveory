export interface Project {
  id: string
  name: string
  /** Folder the user opened. */
  path: string
  /** Git repository root, when the folder belongs to a repository. */
  repositoryRoot?: string
  createdAt: string
  updatedAt: string
  lastOpenedAt: string
}

export type ProjectSort = 'recent' | 'name'
