import fs from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { NectarDatabase } from '../db/index.js';

export interface MemoryFile {
  path: string;
  type: 'memory' | 'agent_session' | 'agent_summary' | 'handoff' | 'task_state';
  content: string;
  frontmatter?: Record<string, any>;
}

export class MemoryManager {
  private db: NectarDatabase;
  private projectPath: string;

  constructor(db: NectarDatabase, projectPath: string) {
    this.db = db;
    this.projectPath = projectPath;
  }

  async ensureStructure(): Promise<void> {
    const nectarPath = path.join(this.projectPath, '.nectar');
    const dirs = [
      path.join(nectarPath, 'memory'),
      path.join(nectarPath, 'agents', 'sessions'),
      path.join(nectarPath, 'agents', 'summaries'),
      path.join(nectarPath, 'tasks'),
      path.join(nectarPath, 'index'),
    ];

    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
    }

    // Create default memory files if they don't exist
    const memoryFiles = [
      { name: 'project.md', title: 'Project Overview' },
      { name: 'architecture.md', title: 'Architecture' },
      { name: 'decisions.md', title: 'Architecture Decisions' },
      { name: 'conventions.md', title: 'Coding Conventions' },
      { name: 'patterns.md', title: 'Design Patterns' },
      { name: 'bugs.md', title: 'Known Bugs & Issues' },
      { name: 'knowledge.md', title: 'General Knowledge' },
    ];

    for (const file of memoryFiles) {
      const filePath = path.join(nectarPath, 'memory', file.name);
      try {
        await fs.access(filePath);
      } catch {
        await fs.writeFile(
          filePath,
          `# ${file.title}\n\n<!-- Add content here -->\n`,
          'utf-8'
        );
      }
    }
  }

  async readMemoryFile(relativePath: string): Promise<MemoryFile | null> {
    const fullPath = path.join(this.projectPath, '.nectar', relativePath);
    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      const parsed = matter(content);
      
      let type: MemoryFile['type'] = 'memory';
      if (relativePath.startsWith('agents/sessions/')) type = 'agent_session';
      else if (relativePath.startsWith('agents/summaries/')) type = 'agent_summary';
      else if (relativePath === 'agents/handoffs.md') type = 'handoff';
      else if (relativePath.startsWith('tasks/')) type = 'task_state';

      return {
        path: relativePath,
        type,
        content: parsed.content,
        frontmatter: parsed.data,
      };
    } catch {
      return null;
    }
  }

  async writeMemoryFile(relativePath: string, content: string, frontmatter?: Record<string, any>): Promise<void> {
    const fullPath = path.join(this.projectPath, '.nectar', relativePath);
    const dir = path.dirname(fullPath);
    await fs.mkdir(dir, { recursive: true });

    const fileContent = matter.stringify(content, frontmatter || {});
    await fs.writeFile(fullPath, fileContent, 'utf-8');
  }

  async listMemoryFiles(): Promise<string[]> {
    const memoryPath = path.join(this.projectPath, '.nectar', 'memory');
    const files = await fs.readdir(memoryPath);
    return files.filter((f: string) => f.endsWith('.md')).map((f: string) => path.join('memory', f));
  }

  async parseMarkdownToChunks(content: string): Promise<Array<{ text: string; heading?: string }>> {
    const processor = unified().use(remarkParse);
    const tree = processor.parse(content);
    
    const chunks: Array<{ text: string; heading?: string }> = [];
    let currentHeading: string | undefined;
    let currentText = '';

    for (const node of tree.children as any[]) {
      if (node.type === 'heading') {
        if (currentText.trim()) {
          chunks.push({ text: currentText.trim(), heading: currentHeading });
          currentText = '';
        }
        currentHeading = node.children.map((c: any) => c.value).join('');
      } else if (node.type === 'paragraph') {
        const text = node.children.map((c: any) => c.value).join('');
        currentText += text + '\n\n';
      }
    }

    if (currentText.trim()) {
      chunks.push({ text: currentText.trim(), heading: currentHeading });
    }

    return chunks;
  }
}
