'use client';

import { useState } from 'react';
import TerminalPane from './TerminalPane';
import { Plus } from 'lucide-react';

interface ADEPanelProps {
  layout?: 1 | 2;
  workingDir?: string | null;
}

export default function ADEPanel({ layout, workingDir }: ADEPanelProps) {
  const [panes, setPanes] = useState<string[]>(['1']);
  const [maximizedPane, setMaximizedPane] = useState<string | null>(null);

  const addPane = () => {
    if (panes.length >= 16) return; // Max 16 panes like Bridge Space
    const newId = (panes.length + 1).toString();
    setPanes([...panes, newId]);
  };

  const removePane = (paneId: string) => {
    const newPanes = panes.filter(p => p !== paneId);
    setPanes(newPanes);
    if (maximizedPane === paneId) {
      setMaximizedPane(null);
    }
  };

  const toggleMaximize = (paneId: string) => {
    setMaximizedPane(maximizedPane === paneId ? null : paneId);
  };

  const getGridColumns = () => {
    return 'grid-cols-4';
  };

  return (
    <div className="flex-1 flex flex-col bg-[#1a1614]">
      {/* ADE toolbar */}
      <div className="h-8 bg-[#241f1c] border-b border-[#3d2e1f] flex items-center justify-between px-3">
        <div className="flex items-center gap-3">
          <span className="text-xs text-[#f5f0e6] font-semibold">ADE</span>
          <span className="text-xs text-[#8a7b5c] bg-[#1a1614] px-2 py-0.5 rounded">
            {panes.length}/16
          </span>
        </div>
        
        <button
          onClick={addPane}
          disabled={panes.length >= 16}
          className="p-1.5 rounded hover:bg-[#3d2e1f] text-[#c9b896] hover:text-[#f5f0e6] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="Add new terminal"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* ADE panes - Grid layout */}
      <div className="flex-1 p-2 overflow-auto">
        {maximizedPane ? (
          <div className="h-full">
            <TerminalPane
              paneId={maximizedPane}
              workingDir={workingDir}
            />
          </div>
        ) : (
          <div className={`h-full grid gap-2 ${getGridColumns()}`}>
            {panes.map((paneId) => (
              <div key={paneId} className="h-full min-h-0 relative">
                <TerminalPane
                  paneId={paneId}
                  workingDir={workingDir}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
