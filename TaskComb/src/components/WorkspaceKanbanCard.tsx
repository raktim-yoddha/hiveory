import { Clock } from 'lucide-react';
import type { TaskCard } from '../board.js';

interface Props {
  task: TaskCard;
  isSelected: boolean;
  onPointerDownCapture?: (e: React.PointerEvent) => void;
  onClick?: (e: React.MouseEvent) => void;
}

const ROLE_DOT: Record<string, string> = {
  builder: 'bg-bee-gold', reviewer: 'bg-blue-400', scout: 'bg-purple-400', coordinator: 'bg-red-400',
};

export default function WorkspaceKanbanCard({ task, isSelected, onPointerDownCapture, onClick }: Props) {
  return (
    <div
      data-workspace-board-card-id={task.id}
      data-workspace-board-card-selected={isSelected ? 'true' : undefined}
      data-workspace-board-pointer-draggable="true"
      onPointerDownCapture={onPointerDownCapture}
      onClick={onClick}
      className={`glass-hi rounded-lg p-2.5 space-y-1.5 cursor-grab active:cursor-grabbing transition-all duration-150 ${
        isSelected ? 'ring-1 ring-bee-gold/60 shadow-[0_0_12px_rgba(201,162,39,0.25)]' : 'hover:shadow-glass-lg'
      }`}
    >
      <span className="text-[11px] font-medium text-bee-text leading-snug block">{task.title}</span>
      {task.description && (
        <p className="text-[9px] text-bee-textMuted leading-relaxed line-clamp-2">{task.description}</p>
      )}
      <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
        {task.assignedRole && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-medium bg-bee-gold/10 text-bee-goldHi border border-bee-gold/20">
            <span className={`w-1 h-1 rounded-full ${ROLE_DOT[task.assignedRole] || 'bg-bee-textMuted'}`} />
            {task.assignedRole}
          </span>
        )}
        {task.assignedCli && (
          <span className="text-[8px] font-mono text-bee-textMuted">{task.assignedCli}</span>
        )}
      </div>
      {task.blockingReason && (
        <div className="flex items-center gap-1 text-[8px] text-bee-warn bg-bee-warn/10 px-1.5 py-0.5 rounded">
          <Clock size={8} />
          waiting on: {task.blockingReason}
        </div>
      )}
    </div>
  );
}
