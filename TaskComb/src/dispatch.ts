import type { TaskCard } from './board.js';

export interface DispatchCommand {
  projectPath: string;
  cli: string;
  taskId: string;
  role: string;
  worktreeDir?: string;
  cwd: string;
  envOverrides?: Record<string, string>;
}

export interface DispatchResolver {
  resolveProjectPath(card: TaskCard): string;
  resolveCli(card: TaskCard): string;
  resolveWorktreeDir(projectPath: string): string;
}

export class DefaultDispatchResolver implements DispatchResolver {
  constructor(private defaultProjectPath: string) {}

  resolveProjectPath(_card: TaskCard): string {
    return this.defaultProjectPath;
  }

  resolveCli(card: TaskCard): string {
    return card.assignedCli || 'opencode';
  }

  resolveWorktreeDir(projectPath: string): string {
    const parts = projectPath.replace(/\\/g, '/').split('/');
    parts.pop();
    return parts.join('/');
  }
}

export function buildDispatchCommand(
  card: TaskCard,
  resolver: DispatchResolver,
): DispatchCommand {
  const projectPath = resolver.resolveProjectPath(card);
  return {
    projectPath,
    cli: resolver.resolveCli(card),
    taskId: card.id,
    role: card.assignedRole || 'builder',
    worktreeDir: resolver.resolveWorktreeDir(projectPath),
    cwd: projectPath,
  };
}
