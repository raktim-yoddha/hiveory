/** A file or folder in the Explorer; `path` is relative to the scope's folder, with forward slashes. */
export interface FileEntry {
  name: string
  path: string
  kind: 'file' | 'dir'
}

/** A file open as a pane in a Workspace's layout (ADR 0018). */
export interface EditorView {
  /** Pane id in the layout. */
  id: string
  workspaceId: string
  /** Relative to the workspace folder. */
  path: string
  name: string
}
