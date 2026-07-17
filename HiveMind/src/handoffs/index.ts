import type { HandoffFs } from '../ports.js';
import { joinPath } from '../ports.js';
import { formatHandoff, parseHandoff, type HandoffEntry } from './format.js';

export type { HandoffEntry } from './format.js';
export { formatHandoff, parseHandoff } from './format.js';

/**
 * Reads/writes `.nectar/agents/handoffs/<taskId>.md`.
 *
 * Storage is injected (see `HandoffFs`) so this class runs unchanged in Node and
 * in the Tauri renderer — only the adapter differs.
 */
export class HandoffManager {
  private handoffsDir: string;

  constructor(nectarPath: string, private fs: HandoffFs) {
    this.handoffsDir = joinPath(nectarPath, '.nectar', 'agents', 'handoffs');
  }

  async ensureStructure(): Promise<void> {
    await this.fs.mkdir(this.handoffsDir);
  }

  async write(taskId: string, entry: Partial<HandoffEntry>): Promise<void> {
    await this.fs.writeFile(joinPath(this.handoffsDir, `${taskId}.md`), formatHandoff(taskId, entry));
  }

  async read(taskId: string): Promise<HandoffEntry | null> {
    try {
      const content = await this.fs.readFile(joinPath(this.handoffsDir, `${taskId}.md`));
      return parseHandoff(content, taskId);
    } catch {
      return null;
    }
  }

  async listByMission(missionId: string): Promise<string[]> {
    try {
      const files = await this.fs.readDir(this.handoffsDir);
      return files
        .filter((f) => f.startsWith(missionId) && f.endsWith('.md'))
        .map((f) => f.replace(/\.md$/, ''));
    } catch {
      return [];
    }
  }
}
