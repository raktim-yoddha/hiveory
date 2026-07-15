import type { TaskCard, ColumnDefinition, ColumnId } from '../board.js';
import WorkspaceKanbanStatusLane from './WorkspaceKanbanStatusLane.js';

interface Props {
  columns: ColumnDefinition[];
  tasksByColumn: Map<ColumnId, TaskCard[]>;
  selectedIds: ReadonlySet<string>;
  columnWidth: number;
  onCommitWidth: (w: number) => void;
  onCardPointerDownCapture?: (e: React.PointerEvent) => void;
  onCardClick?: (e: React.MouseEvent, taskId: string) => void;
  onAddTask?: (colId: ColumnId) => void;
}

export default function WorkspaceKanbanLaneGrid({
  columns, tasksByColumn, selectedIds, columnWidth, onCommitWidth,
  onCardPointerDownCapture, onCardClick, onAddTask,
}: Props) {
  return (
    <div className="flex gap-3 h-full min-h-0 px-4 py-3" style={{ minWidth: `${columns.length * (columnWidth + 12)}px` }}>
      {columns.map((col) => (
        <WorkspaceKanbanStatusLane key={col.id} column={col} tasks={tasksByColumn.get(col.id) ?? []}
          selectedIds={selectedIds} columnWidth={columnWidth} onCommitWidth={onCommitWidth}
          onCardPointerDownCapture={onCardPointerDownCapture} onCardClick={onCardClick} onAddTask={onAddTask} />
      ))}
    </div>
  );
}
