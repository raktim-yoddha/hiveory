import { Plus } from 'lucide-react';
import type { TaskCard, ColumnDefinition, ColumnId } from '../board.js';
import WorkspaceKanbanCard from './WorkspaceKanbanCard.js';
import { useWorkspaceKanbanColumnResize } from './use-workspace-kanban-column-resize.js';

interface Props {
  column: ColumnDefinition;
  tasks: TaskCard[];
  selectedIds: ReadonlySet<string>;
  columnWidth: number;
  onCommitWidth: (w: number) => void;
  onCardPointerDownCapture?: (e: React.PointerEvent) => void;
  onCardClick?: (e: React.MouseEvent, taskId: string) => void;
  onAddTask?: (colId: ColumnId) => void;
}

export default function WorkspaceKanbanStatusLane({
  column, tasks, selectedIds, columnWidth, onCommitWidth,
  onCardPointerDownCapture, onCardClick, onAddTask,
}: Props) {
  const { onColumnResizePointerDown, onColumnResizeKeyDown } = useWorkspaceKanbanColumnResize(columnWidth, onCommitWidth);

  return (
    <section data-workspace-status-drop-target data-workspace-status={column.id}
      className="flex flex-col flex-shrink-0 rounded-xl glass overflow-hidden h-full relative"
      style={{ width: `${columnWidth}px` }}
    >
      <div className="absolute right-0 top-0 h-9 w-2 cursor-col-resize z-10 group"
        onPointerDown={onColumnResizePointerDown} onKeyDown={onColumnResizeKeyDown} tabIndex={0}
        role="separator" aria-valuemin={220} aria-valuemax={520} aria-valuenow={columnWidth}
      >
        <div className="w-0.5 h-full mx-auto rounded-full bg-bee-border/40 group-hover:bg-bee-gold/60 group-hover:w-1 transition-all" />
      </div>
      <div className="flex items-center justify-between px-3 py-2 border-b border-bee-border/50 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-semibold text-bee-text uppercase tracking-wider truncate">{column.title}</span>
          <span className="text-[9px] font-mono text-bee-textMuted bg-bee-border/30 px-1.5 py-0.5 rounded-full shrink-0">{tasks.length}</span>
        </div>
        {onAddTask && (
          <button onClick={() => onAddTask(column.id)} className="p-0.5 rounded hover:bg-bee-border/40 text-bee-textMuted hover:text-bee-goldHi transition-colors shrink-0">
            <Plus size={12} />
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-0">
        {tasks.length === 0 ? (
          <div className="text-[10px] text-bee-textMuted text-center py-4 italic">No tasks</div>
        ) : (
          tasks.map((task) => (
            <WorkspaceKanbanCard key={task.id} task={task} isSelected={selectedIds.has(task.id)}
              onPointerDownCapture={onCardPointerDownCapture} onClick={(e) => onCardClick?.(e, task.id)} />
          ))
        )}
        {onAddTask && (
          <button onClick={() => onAddTask(column.id)}
            className="w-full flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] text-bee-textMuted hover:text-bee-goldHi hover:bg-bee-border/30 transition-colors opacity-0 hover:opacity-100">
            <Plus size={10} /> Add task
          </button>
        )}
      </div>
    </section>
  );
}
