export { Board, COLUMNS, DEFAULT_COLUMNS } from './board.js';
export { DefaultDispatchResolver, buildDispatchCommand } from './dispatch.js';
export type { TaskCard, ColumnId, ColumnDefinition } from './board.js';
export type { DispatchCommand, DispatchResolver } from './dispatch.js';

// React kanban UI components (re-exported from components/ namespace)
export { default as WorkspaceKanbanDrawer } from './components/WorkspaceKanbanDrawer.js';
export { default as WorkspaceKanbanLaneGrid } from './components/WorkspaceKanbanLaneGrid.js';
export { default as WorkspaceKanbanStatusLane } from './components/WorkspaceKanbanStatusLane.js';
export { default as WorkspaceKanbanCard } from './components/WorkspaceKanbanCard.js';
export { default as WorkspaceKanbanDrawerHeader } from './components/WorkspaceKanbanDrawerHeader.js';
export { useWorkspaceBoardPanel } from './components/useWorkspaceBoardPanel.js';
export { useWorkspaceKanbanCardPointerDrag } from './components/use-workspace-kanban-card-pointer-drag.js';
export { useWorkspaceKanbanSelection } from './components/use-workspace-kanban-selection.js';
export { useWorkspaceKanbanColumnResize } from './components/use-workspace-kanban-column-resize.js';
export { groupTasksByColumn } from './components/workspace-kanban-worktree-groups.js';
