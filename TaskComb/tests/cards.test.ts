import { describe, it, expect } from 'vitest';
import { addCard, moveCard, removeCard, cardsByColumn, createCard, newCardId } from '../src/cards.js';
import type { TaskCard } from '../src/board.js';

const ids = (cards: TaskCard[], col: any) => cardsByColumn(cards, col).map((c) => c.title);

function seed(): TaskCard[] {
  let cards: TaskCard[] = [];
  for (const t of ['a', 'b', 'c']) cards = addCard(cards, { title: t, column: 'todo' });
  return cards;
}

describe('addCard', () => {
  it('appends to the end of its column with dense sortOrder', () => {
    const cards = seed();
    expect(ids(cards, 'todo')).toEqual(['a', 'b', 'c']);
    expect(cardsByColumn(cards, 'todo').map((c) => c.sortOrder)).toEqual([0, 1, 2]);
  });

  it('defaults to backlog and empty relations', () => {
    const [card] = addCard([], { title: 'x' });
    expect(card.column).toBe('backlog');
    expect(card.owns).toEqual([]);
    expect(card.dependsOn).toEqual([]);
  });
});

describe('moveCard', () => {
  it('reorders within a column', () => {
    const cards = moveCard(seed(), cardsByColumn(seed(), 'todo')[0].id, 'todo', 2);
    // seed() is regenerated, so match by title instead of a stale id
    const fresh = seed();
    const aId = cardsByColumn(fresh, 'todo').find((c) => c.title === 'a')!.id;
    expect(ids(moveCard(fresh, aId, 'todo', 2), 'todo')).toEqual(['b', 'c', 'a']);
    expect(cards).toBeDefined();
  });

  it('moves across columns and renumbers BOTH columns densely', () => {
    const fresh = seed();
    const bId = cardsByColumn(fresh, 'todo').find((c) => c.title === 'b')!.id;
    const out = moveCard(fresh, bId, 'done', 0);

    expect(ids(out, 'todo')).toEqual(['a', 'c']);
    expect(cardsByColumn(out, 'todo').map((c) => c.sortOrder)).toEqual([0, 1]);
    expect(ids(out, 'done')).toEqual(['b']);
    expect(cardsByColumn(out, 'done').map((c) => c.sortOrder)).toEqual([0]);
  });

  it('appends when targetIndex is omitted', () => {
    const fresh = seed();
    const aId = cardsByColumn(fresh, 'todo').find((c) => c.title === 'a')!.id;
    expect(ids(moveCard(fresh, aId, 'todo'), 'todo')).toEqual(['b', 'c', 'a']);
  });

  it('clamps an out-of-range index instead of leaving a hole', () => {
    const fresh = seed();
    const aId = cardsByColumn(fresh, 'todo').find((c) => c.title === 'a')!.id;
    const out = moveCard(fresh, aId, 'done', 99);
    expect(cardsByColumn(out, 'done').map((c) => c.sortOrder)).toEqual([0]);
  });

  it('is a no-op for an unknown card', () => {
    const fresh = seed();
    expect(moveCard(fresh, 'nope', 'done')).toBe(fresh);
  });

  it('does not mutate the input array', () => {
    const fresh = seed();
    const snapshot = JSON.stringify(fresh);
    const aId = cardsByColumn(fresh, 'todo')[0].id;
    moveCard(fresh, aId, 'done', 0);
    expect(JSON.stringify(fresh)).toBe(snapshot);
  });
});

describe('removeCard', () => {
  it('closes the gap in sortOrder', () => {
    const fresh = seed();
    const bId = cardsByColumn(fresh, 'todo').find((c) => c.title === 'b')!.id;
    const out = removeCard(fresh, bId);
    expect(ids(out, 'todo')).toEqual(['a', 'c']);
    expect(cardsByColumn(out, 'todo').map((c) => c.sortOrder)).toEqual([0, 1]);
  });
});

describe('newCardId', () => {
  it('does not collide when called in a tight loop', () => {
    const set = new Set(Array.from({ length: 500 }, () => newCardId()));
    expect(set.size).toBe(500);
  });
});

describe('createCard', () => {
  it('carries dispatch metadata through', () => {
    const c = createCard({ title: 't', assignedCli: 'claude', worktreeBranch: 'agent/t1', owns: ['a.ts'] });
    expect(c.assignedCli).toBe('claude');
    expect(c.worktreeBranch).toBe('agent/t1');
    expect(c.owns).toEqual(['a.ts']);
  });
});
