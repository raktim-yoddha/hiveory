/** A file or folder in the Explorer; `path` is relative to the scope's folder, with forward slashes. */
export interface FileEntry {
  name: string
  path: string
  kind: 'file' | 'dir'
}

/** A file open as a pane in a Workspace's layout (ADR 0018). */
/** A code editor installed on this computer that a worktree can open in (ADR 0064). */
export interface EditorApp {
  id: string
  label: string
}

export interface EditorView {
  /** Pane id in the layout. */
  id: string
  workspaceId: string
  /** Relative to the workspace folder. */
  path: string
  name: string
  /** The worktree's changes, every file's diff in one pane, rather than one file (ADR 0064). */
  kind?: 'review'
}
