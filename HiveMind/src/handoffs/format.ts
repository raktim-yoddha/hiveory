/**
 * Handoff markdown format — pure, no I/O.
 *
 * Single-sourced here so the Node CLI and the desktop app produce byte-identical
 * `.nectar/agents/handoffs/<task>.md` files, and so the format is testable
 * without touching a filesystem.
 */

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

export function formatHandoff(taskId: string, entry: Partial<HandoffEntry>): string {
  const lines = [
    `## Task: ${taskId}`,
    entry.role ? `Role: ${entry.role}` : '',
    entry.status ? `Status: ${entry.status}` : '',
    entry.worktreePath
      ? `Worktree: ${entry.worktreePath}${entry.branchName ? ` (branch: ${entry.branchName})` : ''}`
      : '',
    entry.filesTouched?.length ? `Files touched: ${entry.filesTouched.join(', ')}` : '',
    entry.summary ? `Summary: ${entry.summary}` : '',
    entry.blocking?.length ? `Blocking: ${entry.blocking.join(', ')}` : 'Blocking: none',
    entry.dependsOn?.length ? `Depends-on: ${entry.dependsOn.join(', ')}` : 'Depends-on: none',
    entry.reviewerNotes !== undefined ? `Reviewer-notes: ${entry.reviewerNotes}` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

export function parseHandoff(content: string, taskId: string): HandoffEntry {
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
        else entry.worktreePath = value;
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
