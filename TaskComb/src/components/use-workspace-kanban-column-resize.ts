import { useCallback, useEffect, useRef, useState } from 'react';

const MIN_WIDTH = 220;
const MAX_WIDTH = 520;
const KEYBOARD_STEP = 20;

export function useWorkspaceKanbanColumnResize(committedWidth: number, onCommitWidth: (w: number) => void) {
  const [draftWidth, setDraftWidth] = useState(committedWidth);
  const [isResizing, setIsResizing] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const draftWidthRef = useRef(committedWidth);

  useEffect(() => {
    if (!isResizing) {
      setDraftWidth(committedWidth);
      draftWidthRef.current = committedWidth;
    }
  }, [committedWidth, isResizing]);

  const clamp = useCallback((w: number) => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, w)), []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    setIsResizing(true);
    startXRef.current = e.clientX;
    startWidthRef.current = draftWidthRef.current;
  }, []);

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!isResizing) return;
      const delta = e.clientX - startXRef.current;
      const next = clamp(startWidthRef.current + delta);
      draftWidthRef.current = next;
      setDraftWidth(next);
    },
    [isResizing, clamp],
  );

  const onPointerUp = useCallback(() => {
    if (!isResizing) return;
    setIsResizing(false);
    onCommitWidth(draftWidthRef.current);
  }, [isResizing, onCommitWidth]);

  useEffect(() => {
    if (!isResizing) return;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [isResizing, onPointerMove, onPointerUp]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        const next = clamp(draftWidthRef.current - KEYBOARD_STEP * (e.shiftKey ? 2 : 1));
        draftWidthRef.current = next; setDraftWidth(next); onCommitWidth(next);
      } else if (e.key === 'ArrowRight') {
        const next = clamp(draftWidthRef.current + KEYBOARD_STEP * (e.shiftKey ? 2 : 1));
        draftWidthRef.current = next; setDraftWidth(next); onCommitWidth(next);
      }
    },
    [clamp, onCommitWidth],
  );

  return { columnWidth: draftWidth, isResizing, onColumnResizePointerDown: onPointerDown, onColumnResizeKeyDown: onKeyDown };
}
