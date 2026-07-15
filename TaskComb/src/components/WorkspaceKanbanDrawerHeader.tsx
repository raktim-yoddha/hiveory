import { X } from 'lucide-react';

interface Props { selectedCount: number; onClose: () => void; }

export default function WorkspaceKanbanDrawerHeader({ selectedCount, onClose }: Props) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-bee-border/50 shrink-0">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-bee-gold uppercase tracking-wider">Workspace Board</span>
        {selectedCount > 0 && (
          <span className="text-[10px] font-mono text-bee-goldHi bg-bee-gold/10 px-1.5 py-0.5 rounded-full border border-bee-gold/20">
            {selectedCount} selected
          </span>
        )}
      </div>
      <button onClick={onClose} className="p-1 rounded-md hover:bg-bee-border/60 text-bee-textMuted hover:text-bee-text transition-colors">
        <X size={14} />
      </button>
    </div>
  );
}
