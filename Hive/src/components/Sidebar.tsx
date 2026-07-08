'use client';

import { useState, useEffect } from 'react';
import { ChevronRight, ChevronDown, Folder, File, FolderOpen } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

interface SidebarProps {
  mode: 'editor' | 'ade';
  onModeChange: (mode: 'editor' | 'ade') => void;
  onFileSelect: (file: string) => void;
  onFolderSelect?: (folder: string) => void;
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
}: SidebarProps) {
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [projectPath, setProjectPath] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadProject = async () => {
      try {
        const path = await invoke<string>('get_project_path');
        setProjectPath(path);
        await loadDirectory(path);
      } catch (e) {
        console.error('Failed to load project:', e);
      } finally {
        setLoading(false);
      }
    };
    loadProject();
  }, []);

  const loadDirectory = async (path: string): Promise<FileNode[]> => {
    try {
      const files = await invoke<any[]>('list_directory', { path });
      return files.map((f: any) => ({
        name: f.name,
        path: f.path,
        is_file: f.is_file,
        is_dir: f.is_dir,
        children: f.is_dir ? [] : undefined,
        expanded: false,
      }));
    } catch (e) {
      console.error('Failed to load directory:', e);
      return [];
    }
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
            loadDirectory(node.path).then(children => {
              currentNode.children = children;
              currentNode.expanded = true;
              setFileTree([...newTree]);
            });
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

  const getFileIcon = (filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase();
    const icons: Record<string, string> = {
      ts: '📘',
      tsx: '⚛️',
      js: '📜',
      jsx: '⚛️',
      json: '📋',
      md: '📝',
      css: '🎨',
      html: '🌐',
      rs: '🦀',
      toml: '⚙️',
      gitignore: '🚫',
    };
    return icons[ext || ''] || '📄';
  };

  const renderFileTree = (nodes: FileNode[], level: number = 0) => {
    return nodes.map((node, index) => (
      <div key={node.path}>
        <div
          className="flex items-center gap-1 px-2 py-0.5 text-sm cursor-pointer hover:bg-[#2a2d2e] rounded"
          style={{ paddingLeft: `${level * 12 + 8}px` }}
          onClick={() => {
            if (node.is_dir) {
              toggleExpand(node, index);
              if (onFolderSelect) {
                onFolderSelect(node.path);
              }
            } else {
              onFileSelect(node.path);
            }
          }}
        >
          {node.is_dir ? (
            <>
              {node.expanded ? <ChevronDown size={12} className="text-gray-500" /> : <ChevronRight size={12} className="text-gray-500" />}
              {node.expanded ? <FolderOpen size={14} className="text-yellow-500" /> : <Folder size={14} className="text-yellow-500" />}
            </>
          ) : (
            <>
              <span className="w-3" />
              <span className="text-sm">{getFileIcon(node.name)}</span>
            </>
          )}
          <span className="ml-1 text-gray-300">{node.name}</span>
        </div>
        {node.expanded && node.children && renderFileTree(node.children, level + 1)}
      </div>
    ));
  };

  return (
    <div className="flex-1 overflow-auto">
      {loading ? (
        <div className="px-4 py-2 text-sm text-gray-500">Loading...</div>
      ) : (
        <div className="py-1">
          {renderFileTree(fileTree)}
        </div>
      )}
    </div>
  );
}
