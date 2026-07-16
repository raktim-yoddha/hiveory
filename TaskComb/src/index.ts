export { Board, COLUMNS, DEFAULT_COLUMNS } from './board.js';
export { DefaultDispatchResolver, buildDispatchCommand } from './dispatch.js';
export type { TaskCard, ColumnId, ColumnDefinition } from './board.js';
export type { DispatchCommand, DispatchResolver } from './dispatch.js';

// Pipeline types + builder
export { buildPipeline, nodeStatus } from './pipeline.js';
export type { PipelineNode, PipelineStage, NodeStatus } from './pipeline.js';

// React kanban UI components (re-exported from components/ namespace)
export { default as TaskCombDrawer } from './components/TaskCombDrawer.js';
export { default as TaskCombLaneGrid } from './components/TaskCombLaneGrid.js';
export { default as TaskCombStatusLane } from './components/TaskCombStatusLane.js';
export { default as TaskCombCard } from './components/TaskCombCard.js';
export { default as TaskCombDrawerHeader } from './components/TaskCombDrawerHeader.js';
export { useTaskCombBoardPanel } from './components/useTaskCombBoardPanel.js';
export { useTaskCombCardPointerDrag } from './components/use-taskcomb-card-pointer-drag.js';
export { useTaskCombSelection } from './components/use-taskcomb-selection.js';
export { useTaskCombColumnResize } from './components/use-taskcomb-column-resize.js';
export { groupTasksByColumn } from './components/taskcomb-worktree-groups.js';

// Pipeline board
export { default as PipelineBoard } from './components/PipelineBoard.js';
