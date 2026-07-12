import { describe, it, expect, vi } from 'vitest';
import { WorkerBeeLauncher, type LaunchOptions } from '../src/launcher.js';
import type { Nectar, InjectionResult, InjectionContext } from '@hiveory/nectar';

function createMockNectar(): Nectar {
  const memoryManager = {
    ensureStructure: vi.fn(),
    listMemoryFiles: vi.fn().mockResolvedValue([]),
    readMemoryFile: vi.fn().mockResolvedValue(null),
    writeMemoryFile: vi.fn().mockResolvedValue(undefined),
    parseMarkdownToChunks: vi.fn().mockResolvedValue([]),
  };

  return {
    getMemoryManager: () => memoryManager,
    inject: vi.fn().mockImplementation((ctx: InjectionContext): Promise<InjectionResult> => {
      return Promise.resolve({
        chunks: [],
        query: ctx.task,
        totalTokens: 0,
      });
    }),
    search: vi.fn(),
    indexFile: vi.fn(),
    reindexAll: vi.fn(),
    close: vi.fn(),
  } as unknown as Nectar;
}

describe('WorkerBeeLauncher', () => {
  it('creates a launcher and returns active sessions', () => {
    const nectar = createMockNectar();
    const launcher = new WorkerBeeLauncher(nectar);
    expect(launcher.getActiveSessions()).toEqual([]);
  });

  it('launch returns a session id and command', async () => {
    const nectar = createMockNectar();
    const launcher = new WorkerBeeLauncher(nectar);

    const result = await launcher.launch({
      projectPath: '/test',
      paneId: 'pane-1',
      task: 'add login page',
      agentType: 'opencode',
    });

    expect(result.sessionId).toContain('opencode-');
    expect(result.command).toBeDefined();
    expect(result.command.command).toBe('opencode');
  });

  it('endSession cleans up session', async () => {
    const nectar = createMockNectar();
    const launcher = new WorkerBeeLauncher(nectar);

    const result = await launcher.launch({
      projectPath: '/test',
      paneId: 'pane-1',
      task: 'refactor auth',
      agentType: 'claude',
    });

    expect(launcher.getActiveSessions()).toContain(result.sessionId);

    await launcher.endSession(result.sessionId, {
      agentType: 'claude',
      sessionId: result.sessionId,
      changes: ['Updated auth.ts'],
      decisions: [],
      timestamp: Date.now(),
    });

    expect(launcher.getActiveSessions()).not.toContain(result.sessionId);
  });

  it('supports all agent types', async () => {
    const nectar = createMockNectar();
    const launcher = new WorkerBeeLauncher(nectar);
    const types: LaunchOptions['agentType'][] = [
      'claude', 'codex', 'aider', 'antigravity',
      'opencode', 'kimi', 'cline', 'cursor', 'kiro', 'kilo',
    ];

    for (const agentType of types) {
      const result = await launcher.launch({
        projectPath: '/test',
        paneId: 'pane-1',
        task: 'test task',
        agentType,
      });
      expect(result.sessionId).toContain(`${agentType}-`);
    }
  });
});
