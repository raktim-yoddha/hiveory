import type { InjectionResult } from '@hiveory/nectar';

export interface LaunchContext {
  paneId: string;
  task: string;
  openFiles: string[];
  gitDiff?: string;
  nectarContext: InjectionResult;
}

export interface CommandConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface SessionSummary {
  agentType: string;
  sessionId: string;
  changes: string[];
  decisions: Array<{
    type: 'architecture' | 'convention' | 'bug_fix' | 'general';
    description: string;
  }>;
  timestamp: number;
}

export interface WorkerBeeAdapter {
  readonly name: string;
  readonly type: string;
  getCommand(context: LaunchContext): CommandConfig;
  onSessionEnd(summary: SessionSummary): Promise<void>;
  formatContext(context: InjectionResult): string;
}
