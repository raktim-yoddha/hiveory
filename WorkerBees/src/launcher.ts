import type { Nectar, InjectionContext, InjectionResult } from '@hiveory/nectar';
import type { WorkerBeeAdapter, LaunchContext, SessionSummary, CommandConfig } from './types.js';
import { OpenCodeAdapter } from './adapters/opencode.js';
import { ClaudeCodeAdapter } from './adapters/claude-code.js';
import { CodexAdapter } from './adapters/codex.js';
import { AiderAdapter } from './adapters/aider.js';
import { AntigravityAdapter } from './adapters/antigravity.js';
import { KimiCodeAdapter } from './adapters/kimi-code.js';
import { ClineAdapter } from './adapters/cline.js';
import { CursorAdapter } from './adapters/cursor.js';
import { KiroAdapter } from './adapters/kiro.js';
import { KiloAdapter } from './adapters/kilo.js';

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

    const injectionContext: InjectionContext = {
      task: options.task,
      openFiles: options.openFiles || [],
      gitDiff: options.gitDiff,
    };

    const nectarContext: InjectionResult = await this.nectar.inject(injectionContext);

    const memoryManager = this.nectar.getMemoryManager();
    await memoryManager.writeMemoryFile(
      `agents/sessions/${sessionId}.md`,
      `# Session Started\n\nAgent: ${options.agentType}\nTask: ${options.task}\nInjection: ${nectarContext.chunks.length} chunks\n`,
      { agent: options.agentType, timestamp: Date.now() }
    );

    const adapter = this.createAdapter(options.agentType);

    const launchContext: LaunchContext = {
      paneId: options.paneId,
      task: options.task,
      openFiles: options.openFiles || [],
      gitDiff: options.gitDiff,
      nectarContext,
    };

    const command = adapter.getCommand(launchContext);
    const injectionText = adapter.formatContext(nectarContext);

    if (injectionText && command.args.length > 0) {
      command.args[0] = `${injectionText}\n\n${command.args[0]}`;
    } else if (injectionText) {
      command.args.unshift(injectionText);
    }

    this.activeSessions.set(sessionId, { adapter, sessionId });

    return { sessionId, command, injectionText };
  }

  async endSession(sessionId: string, summary: SessionSummary): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    await session.adapter.onSessionEnd(summary);
    this.activeSessions.delete(sessionId);
  }

  private createAdapter(type: LaunchOptions['agentType']): WorkerBeeAdapter {
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
