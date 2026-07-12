import fs from 'node:fs/promises';
import path from 'node:path';

export interface HandoffEntry {
  taskId: string;
  role: string;
  status: string;
  worktreePath?: string;
  branchName?: string;
  filesTouched: string[];
  summary: string;
  blocking: string[];
  dependsOn: string[];
  reviewerNotes?: string;
}

export class HandoffManager {
  private handoffsDir: string;

  constructor(private nectarPath: string) {
    this.handoffsDir = path.join(nectarPath, '.nectar', 'agents', 'handoffs');
  }

  async ensureStructure(): Promise<void> {
    await fs.mkdir(this.handoffsDir, { recursive: true });
  }

  async write(taskId: string, entry: Partial<HandoffEntry>): Promise<void> {
    const lines = [
      `## Task: ${taskId}`,
      entry.role ? `Role: ${entry.role}` : '',
      entry.status ? `Status: ${entry.status}` : '',
      entry.worktreePath ? `Worktree: ${entry.worktreePath}${entry.branchName ? ` (branch: ${entry.branchName})` : ''}` : '',
      entry.filesTouched?.length ? `Files touched: ${entry.filesTouched.join(', ')}` : '',
      entry.summary ? `Summary: ${entry.summary}` : '',
      entry.blocking?.length ? `Blocking: ${entry.blocking.join(', ')}` : 'Blocking: none',
      entry.dependsOn?.length ? `Depends-on: ${entry.dependsOn.join(', ')}` : 'Depends-on: none',
      entry.reviewerNotes !== undefined ? `Reviewer-notes: ${entry.reviewerNotes}` : '',
    ];

    const content = lines.filter(Boolean).join('\n');
    await fs.writeFile(path.join(this.handoffsDir, `${taskId}.md`), content, 'utf-8');
  }

  async read(taskId: string): Promise<HandoffEntry | null> {
    try {
      const content = await fs.readFile(path.join(this.handoffsDir, `${taskId}.md`), 'utf-8');
      return this.parse(content, taskId);
    } catch {
      return null;
    }
  }

  async listByMission(missionId: string): Promise<string[]> {
    try {
      const files = await fs.readdir(this.handoffsDir);
      return files
        .filter(f => f.startsWith(missionId) && f.endsWith('.md'))
        .map(f => f.replace(/\.md$/, ''));
    } catch {
      return [];
    }
  }

  private parse(content: string, taskId: string): HandoffEntry {
    const entry: HandoffEntry = {
      taskId, role: '', status: '', filesTouched: [], summary: '',
      blocking: [], dependsOn: [],
    };
    for (const line of content.split('\n')) {
      const idx = line.indexOf(': ');
      if (idx === -1) continue;
      const key = line.slice(0, idx);
      const value = line.slice(idx + 2).trim();
      switch (key) {
        case 'Role': entry.role = value; break;
        case 'Status': entry.status = value; break;
        case 'Worktree': {
          const match = value.match(/^(.*?) \(branch: (.*)\)$/);
          if (match) { entry.worktreePath = match[1]; entry.branchName = match[2]; }
          break;
        }
        case 'Files touched': entry.filesTouched = value.split(', ').filter(Boolean); break;
        case 'Summary': entry.summary = value; break;
        case 'Blocking': entry.blocking = value === 'none' ? [] : value.split(', '); break;
        case 'Depends-on': entry.dependsOn = value === 'none' ? [] : value.split(', '); break;
        case 'Reviewer-notes': entry.reviewerNotes = value; break;
      }
    }
    return entry;
  }
}
