import { describe, it, expect } from 'vitest';
import { Board, COLUMNS } from '../src/board.js';
import { DefaultDispatchResolver, buildDispatchCommand } from '../src/dispatch.js';
import type { TaskCard } from '../src/board.js';

describe('Board', () => {
  it('should add a card and assign timestamps', () => {
    const board = new Board();
    const card = board.addCard({
      id: 'task-1',
      title: 'Implement OAuth',
      description: 'Add OAuth2 login flow',
      column: 'backlog',
      owns: ['src/auth/'],
      reads: ['src/config/'],
      dependsOn: [],
    });
    expect(card.id).toBe('task-1');
    expect(card.column).toBe('backlog');
    expect(card.createdAt).toBeGreaterThan(0);
    expect(card.updatedAt).toBe(card.createdAt);
  });

  it('should move a card through all columns', () => {
    const board = new Board();
    board.addCard({
      id: 'task-1',
      title: 'Implement OAuth',
      description: '',
      column: 'backlog',
      owns: [],
      reads: [],
      dependsOn: [],
    });

    const expectedColumns = ['todo', 'in-progress', 'review', 'done'] as const;
    for (const col of expectedColumns) {
      const moved = board.moveCard('task-1', col);
      expect(moved?.column).toBe(col);
    }
  });

  it('should get cards by column', () => {
    const board = new Board();
    board.addCard({
      id: 'task-1', title: 'Task 1', description: '', column: 'backlog', owns: [], reads: [], dependsOn: [],
    });
    board.addCard({
      id: 'task-2', title: 'Task 2', description: '', column: 'backlog', owns: [], reads: [], dependsOn: [],
    });
    board.addCard({
      id: 'task-3', title: 'Task 3', description: '', column: 'in-progress', owns: [], reads: [], dependsOn: [],
    });

    const backlogCards = board.getCardsByColumn('backlog');
    expect(backlogCards).toHaveLength(2);

    const inProgressCards = board.getCardsByColumn('in-progress');
    expect(inProgressCards).toHaveLength(1);
  });

  it('should remove a card', () => {
    const board = new Board();
    board.addCard({
      id: 'task-1', title: 'Test', description: '', column: 'backlog', owns: [], reads: [], dependsOn: [],
    });
    expect(board.removeCard('task-1')).toBe(true);
    expect(board.getCard('task-1')).toBeUndefined();
  });

  it('should clear all cards', () => {
    const board = new Board();
    board.addCard({
      id: 'task-1', title: 'A', description: '', column: 'backlog', owns: [], reads: [], dependsOn: [],
    });
    board.addCard({
      id: 'task-2', title: 'B', description: '', column: 'todo', owns: [], reads: [], dependsOn: [],
    });
    board.clear();
    expect(board.getAllCards()).toHaveLength(0);
  });

  it('should update specific fields on a card', () => {
    const board = new Board();
    board.addCard({
      id: 'task-1', title: 'T1', description: '', column: 'backlog', owns: [], reads: [], dependsOn: [],
    });
    board.updateCard('task-1', { title: 'T1 Updated', assignedRole: 'builder' });
    const card = board.getCard('task-1')!;
    expect(card.title).toBe('T1 Updated');
    expect(card.assignedRole).toBe('builder');
  });
});

describe('Dispatch', () => {
  it('should build a dispatch command from a card', () => {
    const card: TaskCard = {
      id: 'task-auth-1',
      title: 'OAuth',
      description: '',
      column: 'in-progress',
      owns: ['src/auth/'],
      reads: [],
      dependsOn: [],
      assignedRole: 'builder',
      assignedCli: 'claude-code',
      createdAt: 1,
      updatedAt: 1,
    };

    const resolver = new DefaultDispatchResolver('C:/project/myapp');
    const cmd = buildDispatchCommand(card, resolver);

    expect(cmd.projectPath).toBe('C:/project/myapp');
    expect(cmd.cli).toBe('claude-code');
    expect(cmd.taskId).toBe('task-auth-1');
    expect(cmd.role).toBe('builder');
    expect(cmd.worktreeDir).toBe('C:/project');
    expect(cmd.cwd).toBe('C:/project/myapp');
  });

  it('should default to opencode cli when not assigned', () => {
    const card: TaskCard = {
      id: 'task-2',
      title: 'Test',
      description: '',
      column: 'backlog',
      owns: [],
      reads: [],
      dependsOn: [],
      createdAt: 1,
      updatedAt: 1,
    };

    const resolver = new DefaultDispatchResolver('/project');
    const cmd = buildDispatchCommand(card, resolver);
    expect(cmd.cli).toBe('opencode');
    expect(cmd.role).toBe('builder');
  });
});
