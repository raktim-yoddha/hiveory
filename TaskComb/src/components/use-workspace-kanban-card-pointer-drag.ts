import { useCallback, useEffect, useRef } from 'react';
import type { ColumnId } from '../board.js';

const DRAG_THRESHOLD_PX = 5;
const CLICK_SUPPRESS_MS = 250;

interface DragState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  taskId: string;
  allIds: string[];
  sourceColumn: ColumnId;
  hasStarted: boolean;
}

export function useWorkspaceKanbanCardPointerDrag(
  onDrop: (taskIds: string[], targetColumn: ColumnId, targetIndex?: number) => void,
) {
  const dragRef = useRef<DragState | null>(null);
  const clickSuppressUntilRef = useRef(0);
  const previewRef = useRef<HTMLElement | null>(null);
  const indicatorRef = useRef<HTMLElement | null>(null);

  const createPreview = useCallback((cardEl: HTMLElement) => {
    const clone = cardEl.cloneNode(true) as HTMLElement;
    clone.style.position = 'fixed';
    clone.style.zIndex = '2147483647';
    clone.style.pointerEvents = 'none';
    clone.style.width = `${cardEl.offsetWidth}px`;
    clone.style.borderRadius = 'var(--radius, 8px)';
    clone.style.boxShadow = '0 10px 24px rgba(0,0,0,0.16)';
    clone.style.opacity = '0.96';
    clone.style.transform = 'rotate(2deg) scale(1.02)';
    clone.setAttribute('data-workspace-board-card-drag-preview', 'true');
    document.body.appendChild(clone);
    return clone;
  }, []);

  const updatePreview = useCallback((preview: HTMLElement, cx: number, cy: number) => {
    preview.style.left = `${cx - preview.offsetWidth / 2}px`;
    preview.style.top = `${cy - 24}px`;
  }, []);

  const removePreview = useCallback(() => {
    if (previewRef.current) {
      previewRef.current.remove();
      previewRef.current = null;
    }
  }, []);

  const showDropIndicator = useCallback((x: number, y: number) => {
    removeDropIndicator();
    const el = document.elementFromPoint(x, y);
    if (!el) return;
    const card = el.closest<HTMLElement>('[data-workspace-board-card-id]');
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const indicator = document.createElement('div');
    indicator.setAttribute('data-workspace-board-card-drop-indicator', 'true');
    indicator.style.position = 'fixed';
    indicator.style.zIndex = '2147483646';
    indicator.style.height = '3px';
    indicator.style.borderRadius = '9999px';
    indicator.style.background = 'var(--bee-gold, #c9a227)';
    indicator.style.boxShadow = '0 0 0 1px rgba(201,162,39,0.24), 0 8px 20px rgba(201,162,39,0.36)';
    indicator.style.pointerEvents = 'none';
    indicator.style.width = `${rect.width}px`;
    indicator.style.left = `${rect.left}px`;
    const placeAbove = y < rect.top + rect.height / 2;
    indicator.style.top = placeAbove ? `${rect.top - 2}px` : `${rect.bottom - 1}px`;
    document.body.appendChild(indicator);
    indicatorRef.current = indicator;
    requestAnimationFrame(() => { indicator.style.opacity = '1'; });
  }, []);

  const removeDropIndicator = useCallback(() => {
    if (indicatorRef.current) {
      indicatorRef.current.remove();
      indicatorRef.current = null;
    }
  }, []);

  const stopDrag = useCallback(
    (commit: boolean) => {
      const drag = dragRef.current;
      if (!drag) return;

      if (commit && drag.hasStarted) {
        const el = document.elementFromPoint(drag.currentX, drag.currentY);
        let targetColumn: ColumnId = drag.sourceColumn;
        let targetIndex: number | undefined;

        if (el) {
          const lane = el.closest<HTMLElement>('[data-workspace-status-drop-target]');
          if (lane) {
            targetColumn = lane.getAttribute('data-workspace-status') as ColumnId || drag.sourceColumn;
          }
          const targetCard = el.closest<HTMLElement>('[data-workspace-board-card-id]');
          if (targetCard) {
            const rect = targetCard.getBoundingClientRect();
            const allCards = Array.from(document.querySelectorAll<HTMLElement>('[data-workspace-board-card-id]'));
            targetIndex = allCards.indexOf(targetCard);
            if (targetIndex !== -1 && drag.currentY > rect.top + rect.height / 2) {
              targetIndex++;
            }
          }
        }

        onDrop(drag.allIds, targetColumn, targetIndex);
        clickSuppressUntilRef.current = Date.now() + CLICK_SUPPRESS_MS;
      }

      document.querySelectorAll('[data-workspace-board-card-pointer-dragging]').forEach((el) => {
        (el as HTMLElement).style.outline = '';
        el.removeAttribute('data-workspace-board-card-pointer-dragging');
      });
      document.body.style.cursor = '';
      removePreview();
      removeDropIndicator();
      dragRef.current = null;
    },
    [onDrop, removePreview, removeDropIndicator],
  );

  const onPointerDownCapture = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      if (Date.now() < clickSuppressUntilRef.current) return;

      const cardEl = (e.target as HTMLElement).closest<HTMLElement>('[data-workspace-board-card-id]');
      if (!cardEl) return;

      const taskId = cardEl.getAttribute('data-workspace-board-card-id');
      if (!taskId) return;

      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

      const lane = cardEl.closest<HTMLElement>('[data-workspace-status]');
      const sourceColumn = (lane?.getAttribute('data-workspace-status') ?? 'backlog') as ColumnId;

      const isSelected = cardEl.getAttribute('data-workspace-board-card-selected') === 'true';
      let allIds: string[];
      if (isSelected) {
        allIds = Array.from(document.querySelectorAll<HTMLElement>('[data-workspace-board-card-selected="true"]'))
          .map((el) => el.getAttribute('data-workspace-board-card-id')!);
      } else {
        allIds = [taskId];
      }

      dragRef.current = {
        startX: e.clientX, startY: e.clientY,
        currentX: e.clientX, currentY: e.clientY,
        taskId, allIds, sourceColumn, hasStarted: false,
      };

      const onPointerMove = (ev: PointerEvent) => {
        if (!dragRef.current) return;
        dragRef.current.currentX = ev.clientX;
        dragRef.current.currentY = ev.clientY;

        const dx = Math.abs(ev.clientX - dragRef.current.startX);
        const dy = Math.abs(ev.clientY - dragRef.current.startY);

        if (!dragRef.current.hasStarted && (dx >= DRAG_THRESHOLD_PX || dy >= DRAG_THRESHOLD_PX)) {
          dragRef.current.hasStarted = true;
          document.body.style.cursor = 'grabbing';
          cardEl.style.outline = '1px solid var(--bee-gold, #c9a227)';
          cardEl.setAttribute('data-workspace-board-card-pointer-dragging', 'true');
          previewRef.current = createPreview(cardEl);
        }

        if (dragRef.current.hasStarted && previewRef.current) {
          updatePreview(previewRef.current, ev.clientX, ev.clientY);
          showDropIndicator(ev.clientX, ev.clientY);
        }
      };

      const onPointerUp = () => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        stopDrag(true);
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    },
    [createPreview, updatePreview, showDropIndicator, stopDrag],
  );

  useEffect(() => {
    return () => { removePreview(); removeDropIndicator(); };
  }, [removePreview, removeDropIndicator]);

  return { onPointerDownCapture };
}
