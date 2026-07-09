'use client';

import { useState, useEffect } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Folder,
  File,
  FileCode,
  FileText,
  FileCog,
  Braces,
  Hash,
  FolderOpen,
  type LucideIcon,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

interface SidebarProps {
  mode: 'editor' | 'ade';
  onModeChange: (mode: 'editor' | 'ade') => void;
  onFileSelect: (file: string) => void;
  onFolderSelect?: (folder: string) => void;
  /** The project folder the user actually opened. Falls back to the Tauri
   * process's cwd only if the user hasn't opened a folder yet. */
  rootPath?: string | null;
}

interface FileNode {
  name: string;
  path: string;
  is_file: boolean;
  is_dir: boolean;
  children?: FileNode[];
  expanded?: boolean;
}

export default function Sidebar({
  mode,
  onModeChange,
  onFileSelect,
  onFolderSelect,
  rootPath,
}: SidebarProps) {
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [projectPath, setProjectPath] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadProject = async () => {
      setLoading(true);
      try {
        // Prefer the folder the user actually opened; only fall back to the
        // Tauri process's own cwd if no project has been opened yet.
        const path = rootPath || (await invoke<string>('get_project_path'));
        setProjectPath(path);
        const tree = await loadDirectory(path);
        setFileTree(tree);
      } catch (e) {
        console.error('Failed to load project:', e);
      } finally {
        setLoading(false);
      }
    };
    loadProject();
  }, [rootPath]);

  const loadDirectory = async (path: string): Promise<FileNode[]> => {
    const files = await invoke<any[]>('list_directory', { path });
    return files.map((f: any) => ({
      name: f.name,
      path: f.path,
      is_file: f.is_file,
      is_dir: f.is_dir,
      children: f.is_dir ? [] : undefined,
      expanded: false,
    }));
  };

  const toggleExpand = async (node: FileNode, index: number) => {
    if (!node.is_dir) return;

    const newTree = [...fileTree];
    const updateNode = (nodes: FileNode[]): boolean => {
      for (let i = 0; i < nodes.length; i++) {
        const currentNode = nodes[i];
        if (!currentNode) continue;
        
        if (currentNode.path === node.path) {
          if (!currentNode.expanded && (!currentNode.children || currentNode.children.length === 0)) {
            loadDirectory(node.path)
              .then(children => {
                currentNode.children = children;
                currentNode.expanded = true;
                setFileTree([...newTree]);
              })
              .catch(e => console.error('Failed to load directory:', e));
          } else {
            currentNode.expanded = !currentNode.expanded;
          }
          return true;
        }
        if (currentNode.children) {
          if (updateNode(currentNode.children)) {
            return true;
          }
        }
      }
      return false;
    };
    updateNode(newTree);
    setFileTree(newTree);
  };

  const getFileIcon = (filename: string): { Icon: LucideIcon; className: string } => {
    const ext = filename.split('.').pop()?.toLowerCase();
    const map: Record<string, { Icon: LucideIcon; className: string }> = {
      ts: { Icon: FileCode, className: 'text-bee-gold' },
      tsx: { Icon: FileCode, className: 'text-bee-goldHi' },
      js: { Icon: FileCode, className: 'text-bee-honey' },
      jsx: { Icon: FileCode, className: 'text-bee-goldHi' },
      rs: { Icon: FileCode, className: 'text-bee-err' },
      json: { Icon: Braces, className: 'text-bee-amber' },
      md: { Icon: FileText, className: 'text-bee-textDim' },
      css: { Icon: Hash, className: 'text-bee-gold' },
      scss: { Icon: Hash, className: 'text-bee-gold' },
      html: { Icon: FileCode, className: 'text-bee-warn' },
      toml: { Icon: FileCog, className: 'text-bee-textMuted' },
      yaml: { Icon: FileCog, className: 'text-bee-textMuted' },
      yml: { Icon: FileCog, className: 'text-bee-textMuted' },
    };
    return map[ext || ''] || { Icon: File, className: 'text-bee-textMuted' };
  };

  const renderFileTree = (nodes: FileNode[], level: number = 0) => {
    return nodes.map((node, index) => {
      const { Icon, className } = getFileIcon(node.name);
      return (
        <div key={node.path}>
          <div
            className="group flex items-center gap-1.5 px-2 py-1 text-[13px] cursor-pointer rounded-md text-bee-textDim hover:bg-bee-gold/10 hover:text-bee-text transition-colors"
            style={{ paddingLeft: `${level * 12 + 8}px` }}
            onClick={() => {
              if (node.is_dir) {
                toggleExpand(node, index);
              } else {
                onFileSelect(node.path);
              }
            }}
          >
            {node.is_dir ? (
              <>
                {node.expanded ? (
                  <ChevronDown size={13} className="text-bee-textMuted flex-shrink-0" />
                ) : (
                  <ChevronRight size={13} className="text-bee-textMuted flex-shrink-0" />
                )}
                {node.expanded ? (
                  <FolderOpen size={14} className="text-bee-gold flex-shrink-0" />
                ) : (
                  <Folder size={14} className="text-bee-gold flex-shrink-0" />
                )}
              </>
            ) : (
              <>
                <span className="w-[13px] flex-shrink-0" />
                <Icon size={14} className={`${className} flex-shrink-0`} />
              </>
            )}
            <span className="ml-0.5 truncate">{node.name}</span>
          </div>
          {node.expanded && node.children && renderFileTree(node.children, level + 1)}
        </div>
      );
    });
  };

  return (
    <div className="flex-1 overflow-auto px-1.5">
      {loading ? (
        <div className="px-3 py-2 text-[13px] text-bee-textMuted">Loading…</div>
      ) : fileTree.length === 0 ? (
        <div className="px-3 py-2 text-[13px] text-bee-textMuted">No files</div>
      ) : (
        <div className="py-1.5">{renderFileTree(fileTree)}</div>
      )}
    </div>
  );
}
