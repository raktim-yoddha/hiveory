import { WorkerBeeAdapter, LaunchContext, SessionSummary, CommandConfig } from './types';
import { Nectar } from '@hiveory/nectar-api';

export class CursorAdapter implements WorkerBeeAdapter {
  readonly name = 'Cursor';
  readonly type = 'cursor' as any;

  constructor(private nectar: Nectar) {}

  getCommand(context: LaunchContext): CommandConfig {
    const args = [];
    const contextText = this.formatContext(context.nectarContext);
    if (contextText) {
      args.push('--context', contextText);
    }
    args.push(context.task);

    return {
      command: 'cursor',
      args,
    };
  }

  async onSessionEnd(summary: SessionSummary): Promise<void> {
    const memoryManager = this.nectar.getMemoryManager();
    const sessionContent = `# Cursor Session\n\nTime: ${new Date(summary.timestamp).toISOString()}\n\n## Changes\n\n${summary.changes.map(c => `- ${c}`).join('\n')}\n\n## Decisions\n\n${summary.decisions.map(d => `- [${d.type}] ${d.description}`).join('\n')}\n`;
    
    await memoryManager.writeMemoryFile(
      `agents/sessions/${summary.sessionId}.md`,
      sessionContent,
      { agent: 'cursor', timestamp: summary.timestamp }
    );

    for (const decision of summary.decisions) {
      const targetFile = this.getDecisionTarget(decision.type);
      const existing = await memoryManager.readMemoryFile(targetFile);
      const content = existing?.content || '';
      const newEntry = `\n## ${new Date(summary.timestamp).toISOString()}\n\n${decision.description}\n`;
      
      await memoryManager.writeMemoryFile(targetFile, content + newEntry);
    }
  }

  formatContext(context: import('@hiveory/nectar-api').InjectionResult): string {
    if (context.chunks.length === 0) return '';
    return `Context:\n${context.chunks
      .map((c, i) => `[${i + 1}] ${c.source_file}: ${c.content}`)
      .join('\n\n')}\n`;
  }

  private getDecisionTarget(type: SessionSummary['decisions'][0]['type']): string {
    switch (type) {
      case 'architecture':
        return 'memory/decisions.md';
      case 'convention':
        return 'memory/conventions.md';
      case 'bug_fix':
        return 'memory/bugs.md';
      default:
        return 'memory/knowledge.md';
    }
  }
}
