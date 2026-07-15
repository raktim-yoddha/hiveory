import type { TaskCard, ColumnDefinition, ColumnId } from '../board.js';

export function groupTasksByColumn(tasks: TaskCard[], columns: ColumnDefinition[]): Map<ColumnId, TaskCard[]> {
  const groups = new Map<ColumnId, TaskCard[]>();
  for (const col of columns) groups.set(col.id, []);
  for (const task of tasks) {
    const group = groups.get(task.column);
    if (group) group.push(task);
  }
  for (const [, cards] of groups) cards.sort((a, b) => a.sortOrder - b.sortOrder);
  return groups;
}
