import { useCallback, useEffect, useRef, useState } from 'react';

export type BoardPanelState = 'closed' | 'drag-preview' | 'open';

export function useWorkspaceBoardPanel() {
  const [state, setState] = useState<BoardPanelState>('closed');
  const openRef = useRef(false);
  const previewRef = useRef(false);

  const open = useCallback(() => { setState('open'); openRef.current = true; previewRef.current = false; }, []);
  const close = useCallback(() => { setState('closed'); openRef.current = false; previewRef.current = false; }, []);
  const toggle = useCallback(() => { if (openRef.current) close(); else open(); }, [open, close]);
  const preview = useCallback(() => { if (!openRef.current && !previewRef.current) { setState('drag-preview'); previewRef.current = true; } }, []);
  const solidify = useCallback(() => {
    if (previewRef.current) { setState('open'); openRef.current = true; previewRef.current = false; }
    else if (openRef.current) previewRef.current = false;
  }, []);
  const cancelPreview = useCallback(() => { if (previewRef.current) { setState('closed'); previewRef.current = false; } }, []);

  useEffect(() => { if (state === 'closed') { openRef.current = false; previewRef.current = false; } }, [state]);

  return {
    state, isOpen: state === 'open', isDragPreview: state === 'drag-preview', isOpenOrPreview: state !== 'closed',
    openBoard: open, closeBoard: close, toggleBoard: toggle, previewBoard: preview, solidifyBoard: solidify, cancelBoardPreview: cancelPreview,
  };
}
