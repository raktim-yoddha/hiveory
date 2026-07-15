import { useCallback, useState } from 'react';

export function useWorkspaceKanbanSelection(taskIds: string[]) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [anchorId, setAnchorId] = useState<string | null>(null);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setAnchorId(null);
  }, []);

  const handleGesture = useCallback(
    (event: React.MouseEvent, taskId: string): boolean => {
      if (event.metaKey || event.ctrlKey) {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          if (next.has(taskId)) next.delete(taskId);
          else next.add(taskId);
          setAnchorId(taskId);
          return next;
        });
        return true;
      }

      if (event.shiftKey && anchorId) {
        const startIdx = taskIds.indexOf(anchorId);
        const endIdx = taskIds.indexOf(taskId);
        if (startIdx !== -1 && endIdx !== -1) {
          const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
          setSelectedIds(new Set(taskIds.slice(from, to + 1)));
        }
        return true;
      }

      setSelectedIds(new Set([taskId]));
      setAnchorId(taskId);
      return false;
    },
    [taskIds, anchorId],
  );

  const handleContextMenu = useCallback(
    (taskId: string): string[] => {
      if (selectedIds.has(taskId) && selectedIds.size > 1) return Array.from(selectedIds);
      return [taskId];
    },
    [selectedIds],
  );

  return { selectedIds, selectedCount: selectedIds.size, clearSelection, handleGesture, handleContextMenu };
}
