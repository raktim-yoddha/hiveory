'use client';

import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm, ITerminalOptions } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { SearchAddon } from 'xterm-addon-search';
import { Terminal, Bot, ChevronDown, Copy, Trash2, X } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

interface TerminalPaneProps {
  paneId?: string;
  workingDir?: string | null;
}

type TerminalType = 'cmd' | 'powershell' | 'git-bash' | 'wsl';
type AgentType = 'none' | 'claude-code' | 'codex-cli' | 'aider' | 'gemini-cli' | 'antigravity' | 'open-code' | 'kimi-code' | 'cursor' | 'windsurf';

const TERMINAL_LABELS: Record<TerminalType, string> = {
  'cmd': 'CMD',
  'powershell': 'PowerShell',
  'git-bash': 'Git Bash',
  'wsl': 'WSL',
};

const AGENT_LABELS: Record<AgentType, string> = {
  'none': 'No Agent',
  'claude-code': 'Claude Code',
  'codex-cli': 'Codex CLI',
  'aider': 'Aider',
  'gemini-cli': 'Gemini CLI',
  'antigravity': 'Antigravity',
  'open-code': 'Open Code',
  'kimi-code': 'Kimi Code',
  'cursor': 'Cursor',
  'windsurf': 'Windsurf',
};

const TERMINAL_COMMANDS: Record<TerminalType, string> = {
  'cmd': 'cmd.exe',
  'powershell': 'powershell.exe',
  'git-bash': 'bash.exe',
  'wsl': 'wsl.exe',
};

export default function TerminalPane({ paneId = 'terminal-1', workingDir }: TerminalPaneProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstance = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [isSpawned, setIsSpawned] = useState(false);
  const [selectedTerminal, setSelectedTerminal] = useState<TerminalType>('powershell');
  const [selectedAgent, setSelectedAgent] = useState<AgentType>('none');
  const [showTerminalMenu, setShowTerminalMenu] = useState(false);
  const [showAgentMenu, setShowAgentMenu] = useState(false);

  useEffect(() => {
    if (!terminalRef.current) return;

    let mounted = true;

    const initTerminal = async () => {
      try {
        const { Terminal } = await import('xterm');
        const { FitAddon } = await import('xterm-addon-fit');
        const { SearchAddon } = await import('xterm-addon-search');

        const options: ITerminalOptions = {
          cursorBlink: true,
          cursorStyle: 'block',
          fontSize: 14,
          fontFamily: 'Cascadia Code, Consolas, "Courier New", monospace',
          fontWeight: '400',
          fontWeightBold: '700',
          lineHeight: 1.2,
          theme: {
            background: '#1a1614',
            foreground: '#f5f0e6',
            cursor: '#c9a227',
            cursorAccent: '#0f0d0c',
            selectionBackground: '#3d2e1f',
            selectionForeground: '#f5f0e6',
            black: '#1a1614',
            red: '#ef4444',
            green: '#22c55e',
            yellow: '#c9a227',
            blue: '#3b82f6',
            magenta: '#a855f7',
            cyan: '#06b6d4',
            white: '#f5f0e6',
            brightBlack: '#3d2e1f',
            brightRed: '#f87171',
            brightGreen: '#4ade80',
            brightYellow: '#d4b84a',
            brightBlue: '#60a5fa',
            brightMagenta: '#c084fc',
            brightCyan: '#22d3ee',
            brightWhite: '#fffbeb',
          },
          allowTransparency: false,
          rightClickSelectsWord: true,
          scrollback: 1000,
        };

        const terminal = new Terminal(options);
        const fitAddon = new FitAddon();
        const searchAddon = new SearchAddon();

        terminal.loadAddon(fitAddon);
        terminal.loadAddon(searchAddon);
        fitAddonRef.current = fitAddon;

        terminal.open(terminalRef.current!);
        fitAddon.fit();

        // Get working directory
        let spawnDir = workingDir;
        if (!spawnDir) {
          try {
            spawnDir = await invoke<string>('get_project_path');
          } catch (e) {
            try {
              spawnDir = await invoke<string>('get_home_dir');
            } catch (e2) {
              console.error('Failed to get working directory:', e2);
            }
          }
        }

        // Spawn terminal
        try {
          const command = TERMINAL_COMMANDS[selectedTerminal];
          await invoke('spawn_terminal', {
            paneId,
            command,
            args: [],
            workingDir: spawnDir,
          });
          
          if (mounted) {
            setIsSpawned(true);
            
            // Start reading output
            const readOutput = async () => {
              while (mounted && isSpawned) {
                try {
                  const output = await invoke<string>('read_from_terminal', { paneId });
                  if (output && mounted) {
                    terminal.write(output);
                  }
                  await new Promise(resolve => setTimeout(resolve, 50));
                } catch (e) {
                  console.error('Read error:', e);
                  break;
                }
              }
            };
            readOutput();
          }
        } catch (e) {
          if (mounted) {
            terminal.writeln(`\x1b[31mFailed to spawn terminal: ${e}\x1b[0m`);
          }
        }

        if (mounted) {
          terminalInstance.current = terminal;

          const handleResize = () => {
            fitAddon.fit();
            if (terminalInstance.current) {
              const { rows, cols } = terminalInstance.current;
              invoke('resize_terminal', { paneId, rows, cols }).catch(console.error);
            }
          };

          window.addEventListener('resize', handleResize);

          return () => {
            window.removeEventListener('resize', handleResize);
            terminal.dispose();
            setIsSpawned(false);
          };
        }
      } catch (e) {
        console.error('Failed to initialize terminal:', e);
      }
    };

    initTerminal();

    return () => {
      mounted = false;
    };
  }, [paneId, selectedTerminal, workingDir]);

  const handleTerminalInput = (data: string) => {
    if (isSpawned) {
      invoke('write_to_terminal', {
        paneId,
        data,
      }).catch(console.error);
    }
  };

  useEffect(() => {
    if (terminalInstance.current && isSpawned) {
      const handleData = (data: string) => {
        handleTerminalInput(data);
      };

      terminalInstance.current.onData(handleData);
    }
  }, [isSpawned, paneId]);

  const handleCopy = () => {
    if (terminalInstance.current) {
      const selection = terminalInstance.current.getSelection();
      if (selection) {
        navigator.clipboard.writeText(selection);
      }
    }
  };

  const handleClear = () => {
    if (terminalInstance.current) {
      terminalInstance.current.clear();
    }
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.dropdown-menu')) {
        setShowTerminalMenu(false);
        setShowAgentMenu(false);
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  return (
    <div className="flex flex-col h-full bg-[#1a1614]">
      {/* Terminal header */}
      <div className="h-8 bg-[#241f1c] border-b border-[#3d2e1f] flex items-center justify-between px-2">
        <div className="flex items-center gap-2">
          <Terminal size={12} className="text-[#c9a227]" />
          <span className="text-xs text-[#f5f0e6] font-medium">Terminal {paneId}</span>
          
          {/* Terminal selector */}
          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); setShowTerminalMenu(!showTerminalMenu); }}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-[#1a1614] border border-[#3d2e1f] rounded hover:border-[#c9a227] text-[#c9b896] hover:text-[#f5f0e6] transition-all"
            >
              <Terminal size={11} className="text-[#c9a227]" />
              {TERMINAL_LABELS[selectedTerminal]}
              <ChevronDown size={10} className="text-[#8a7b5c]" />
            </button>
            {showTerminalMenu && (
              <div className="dropdown-menu absolute left-0 top-8 bg-[#241f1c] border border-[#3d2e1f] rounded shadow-lg z-20 min-w-36">
                <div className="px-2 py-1.5 text-xs text-[#c9a227] font-medium border-b border-[#3d2e1f]">Terminal Type</div>
                {(Object.keys(TERMINAL_LABELS) as TerminalType[]).map((terminal) => (
                  <button
                    key={terminal}
                    onClick={(e) => { 
                      e.stopPropagation(); 
                      setSelectedTerminal(terminal); 
                      setShowTerminalMenu(false); 
                      setIsSpawned(false);
                    }}
                    className={`w-full px-3 py-1.5 text-left text-xs hover:bg-[#3d2e1f] flex items-center gap-2 ${selectedTerminal === terminal ? 'bg-[#3d2e1f] text-[#f5f0e6]' : 'text-[#c9b896]'}`}
                  >
                    <Terminal size={11} className={selectedTerminal === terminal ? 'text-[#c9a227]' : 'text-[#8a7b5c]'} />
                    {TERMINAL_LABELS[terminal]}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Agent selector */}
          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); setShowAgentMenu(!showAgentMenu); }}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-[#1a1614] border border-[#3d2e1f] rounded hover:border-[#c9a227] text-[#c9b896] hover:text-[#f5f0e6] transition-all"
            >
              <Bot size={11} className={selectedAgent === 'none' ? 'text-[#8a7b5c]' : 'text-[#c9a227]'} />
              {AGENT_LABELS[selectedAgent]}
              <ChevronDown size={10} className="text-[#8a7b5c]" />
            </button>
            {showAgentMenu && (
              <div className="dropdown-menu absolute left-0 top-8 bg-[#241f1c] border border-[#3d2e1f] rounded shadow-lg z-20 min-w-40 max-h-64 overflow-y-auto">
                <div className="px-2 py-1.5 text-xs text-[#c9a227] font-medium border-b border-[#3d2e1f]">AI Agent</div>
                {(Object.keys(AGENT_LABELS) as AgentType[]).map((agent) => (
                  <button
                    key={agent}
                    onClick={(e) => { e.stopPropagation(); setSelectedAgent(agent); setShowAgentMenu(false); }}
                    className={`w-full px-3 py-1.5 text-left text-xs hover:bg-[#3d2e1f] flex items-center gap-2 ${selectedAgent === agent ? 'bg-[#3d2e1f] text-[#f5f0e6]' : 'text-[#c9b896]'}`}
                  >
                    <Bot size={11} className={selectedAgent === agent ? 'text-[#c9a227]' : 'text-[#8a7b5c]'} />
                    {AGENT_LABELS[agent]}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleCopy}
            className="p-1.5 rounded hover:bg-[#3d2e1f] text-[#c9b896] hover:text-[#f5f0e6] transition-colors"
            title="Copy"
          >
            <Copy size={12} />
          </button>
          <button
            onClick={handleClear}
            className="p-1.5 rounded hover:bg-[#3d2e1f] text-[#c9b896] hover:text-[#f5f0e6] transition-colors"
            title="Clear"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Terminal content */}
      <div className="flex-1 overflow-hidden">
        <div ref={terminalRef} className="w-full h-full" />
      </div>
    </div>
  );
}
