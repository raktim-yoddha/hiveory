import { Nectar, InjectionContext, InjectionResult } from '@hiveory/nectar-api';
import { WorkerBeeAdapter, LaunchContext, SessionSummary, CommandConfig } from './adapters/types';
import { ClaudeCodeAdapter } from './adapters/claude-code';
import { CodexAdapter } from './adapters/codex';
import { AiderAdapter } from './adapters/aider';
import { AntigravityAdapter } from './adapters/antigravity';
import { OpenCodeAdapter } from './adapters/opencode';
import { KimiCodeAdapter } from './adapters/kimi-code';
import { ClineAdapter } from './adapters/cline';
import { CursorAdapter } from './adapters/cursor';
import { KiroAdapter } from './adapters/kiro';
import { KiloAdapter } from './adapters/kilo';

export interface LaunchOptions {
  projectPath: string;
  paneId: string;
  task: string;
  agentType: 'claude' | 'codex' | 'aider' | 'antigravity' | 'opencode' | 'kimi' | 'cline' | 'cursor' | 'kiro' | 'kilo';
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

  private createAdapter(type: 'claude' | 'codex' | 'aider' | 'antigravity' | 'opencode' | 'kimi' | 'cline' | 'cursor' | 'kiro' | 'kilo'): WorkerBeeAdapter {
    switch (type) {
      case 'claude':
        return new ClaudeCodeAdapter(this.nectar);
      case 'codex':
        return new CodexAdapter(this.nectar);
      case 'aider':
        return new AiderAdapter(this.nectar);
      case 'antigravity':
        return new AntigravityAdapter(this.nectar);
      case 'opencode':
        return new OpenCodeAdapter(this.nectar);
      case 'kimi':
        return new KimiCodeAdapter(this.nectar);
      case 'cline':
        return new ClineAdapter(this.nectar);
      case 'cursor':
        return new CursorAdapter(this.nectar);
      case 'kiro':
        return new KiroAdapter(this.nectar);
      case 'kilo':
        return new KiloAdapter(this.nectar);
    }
  }

  getActiveSessions(): string[] {
    return Array.from(this.activeSessions.keys());
  }
}
