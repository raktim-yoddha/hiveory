'use client';

import { useState, useRef, useEffect } from 'react';
import { GripVertical } from 'lucide-react';

interface ResizeHandleProps {
  direction: 'horizontal' | 'vertical';
  onResize: (delta: number) => void;
  onResizeEnd?: () => void;
  className?: string;
}

export default function ResizeHandle({ direction, onResize, onResizeEnd, className = '' }: ResizeHandleProps) {
  const [isDragging, setIsDragging] = useState(false);
  const startPosRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    startPosRef.current = direction === 'horizontal' ? e.clientY : e.clientX;
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;

      const currentPos = direction === 'horizontal' ? e.clientY : e.clientX;
      const delta = currentPos - startPosRef.current;
      onResize(delta);
      startPosRef.current = currentPos;
    };

    const handleMouseUp = () => {
      if (isDragging) {
        setIsDragging(false);
        onResizeEnd?.();
      }
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, direction, onResize, onResizeEnd]);

  return (
    <div
      ref={containerRef}
      className={`
        ${direction === 'horizontal' ? 'h-1.5 w-full cursor-row-resize' : 'w-1.5 h-full cursor-col-resize'}
        ${isDragging ? 'bg-bee-gold' : 'bg-bee-border/60 hover:bg-bee-gold/60'}
        transition-colors duration-150 flex items-center justify-center
        ${className}
      `}
      onMouseDown={handleMouseDown}
    >
      <GripVertical size={12} className="text-bee-textMuted opacity-0 hover:opacity-100 transition-opacity" />
    </div>
  );
}
