import { Nectar, InjectionContext, InjectionResult } from '@hiveory/nectar-api';
import { WorkerBeeAdapter, LaunchContext, SessionSummary, CommandConfig } from './adapters/types';
import { ClaudeCodeAdapter } from './adapters/claude-code';
import { CodexAdapter } from './adapters/codex';
import { AiderAdapter } from './adapters/aider';
import { GeminiAdapter } from './adapters/gemini';

export interface LaunchOptions {
  projectPath: string;
  paneId: string;
  task: string;
  agentType: 'claude' | 'codex' | 'aider' | 'gemini';
  openFiles?: string[];
  gitDiff?: string;
}

export interface LaunchResult {
  sessionId: string;
  command: CommandConfig;
  injectionText?: string;
}

export class WorkerBeeLauncher {
  private nectar: Nectar;
  private activeSessions: Map<string, { adapter: WorkerBeeAdapter; sessionId: string }>;

  constructor(nectar: Nectar) {
    this.nectar = nectar;
    this.activeSessions = new Map();
  }

  async launch(options: LaunchOptions): Promise<LaunchResult> {
    const sessionId = `${options.agentType}-${Date.now()}`;
    
    // Get Nectar context
    const injectionContext: InjectionContext = {
      task: options.task,
      openFiles: options.openFiles || [],
      gitDiff: options.gitDiff,
    };
    
    const nectarContext = await this.nectar.inject(
      injectionContext.task,
      injectionContext.openFiles,
      injectionContext.gitDiff
    );
    
    // Log injection
    const memoryManager = this.nectar.getMemoryManager();
    await memoryManager.writeMemoryFile(
      `agents/sessions/${sessionId}.md`,
      `# Session Started\n\nAgent: ${options.agentType}\nTask: ${options.task}\nInjection: ${nectarContext.chunks.length} chunks\n`,
      { agent: options.agentType, timestamp: Date.now() }
    );

    // Create adapter
    const adapter = this.createAdapter(options.agentType);
    
    // Launch context
    const launchContext: LaunchContext = {
      paneId: options.paneId,
      task: options.task,
      openFiles: options.openFiles || [],
      gitDiff: options.gitDiff,
      nectarContext,
    };

    // Get command config from adapter
    const command = adapter.getCommand(launchContext);
    
    // Format injection text for the CLI
    const injectionText = adapter.formatContext(nectarContext);
    
    // Prepend injection text to the CLI's task argument
    if (injectionText && command.args.length > 0) {
      command.args[0] = `${injectionText}\n\n${command.args[0]}`;
    } else if (injectionText) {
      command.args.unshift(injectionText);
    }

    // Track session
    this.activeSessions.set(sessionId, { adapter, sessionId });

    return {
      sessionId,
      command,
      injectionText,
    };
  }

  async endSession(sessionId: string, summary: SessionSummary): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    // Call adapter's session end handler
    await session.adapter.onSessionEnd(summary);
    
    // Remove from tracking
    this.activeSessions.delete(sessionId);
  }

  private createAdapter(type: 'claude' | 'codex' | 'aider' | 'gemini'): WorkerBeeAdapter {
    switch (type) {
      case 'claude':
        return new ClaudeCodeAdapter(this.nectar);
      case 'codex':
        return new CodexAdapter(this.nectar);
      case 'aider':
        return new AiderAdapter(this.nectar);
      case 'gemini':
        return new GeminiAdapter(this.nectar);
    }
  }

  getActiveSessions(): string[] {
    return Array.from(this.activeSessions.keys());
  }
}
