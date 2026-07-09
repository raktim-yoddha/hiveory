import { InjectionResult } from '@hiveory/nectar-api';

export interface AdapterConfig {
  projectPath: string;
  agentPath?: string;
  apiKey?: string;
  model?: string;
}

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
  injectionText?: string;
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
  readonly type: 'claude' | 'codex' | 'aider' | 'gemini';

  getCommand(context: LaunchContext): CommandConfig;
  onSessionEnd(summary: SessionSummary): Promise<void>;
  formatContext(context: InjectionResult): string;
}
