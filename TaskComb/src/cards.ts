import type { TaskCard, ColumnId } from './board.js';

/**
 * Pure card operations over a plain array.
 *
 * TaskComb owns board semantics — what a new card defaults to, what moving one
 * does to ordering. These are array-in/array-out so an immutable store (the
 * desktop app's zustand state) and the stateful `Board` class can share exactly
 * one implementation instead of drifting apart.
 */

export interface NewCardInput {
  title: string;
  description?: string;
  column?: ColumnId;
  owns?: string[];
  reads?: string[];
  dependsOn?: string[];
  assignedRole?: string;
  assignedCli?: string;
  missionId?: string;
  workerBeeId?: string;
  worktreeBranch?: string;
  blockingReason?: string;
  id?: string;
}

let counter = 0;

/** Collision-resistant without pulling in a uuid dependency. */
export function newCardId(): string {
  counter = (counter + 1) % 1e6;
  return `task-${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function createCard(input: NewCardInput, sortOrder = 0): TaskCard {
  const now = Date.now();
  return {
    id: input.id ?? newCardId(),
    title: input.title,
    description: input.description ?? '',
    column: input.column ?? 'backlog',
    sortOrder,
    owns: input.owns ?? [],
    reads: input.reads ?? [],
    dependsOn: input.dependsOn ?? [],
    assignedRole: input.assignedRole,
    assignedCli: input.assignedCli,
    missionId: input.missionId,
    workerBeeId: input.workerBeeId,
    worktreeBranch: input.worktreeBranch,
    blockingReason: input.blockingReason,
    createdAt: now,
    updatedAt: now,
  };
}

/** Cards of one column, in order. */
export function cardsByColumn(cards: TaskCard[], column: ColumnId): TaskCard[] {
  return cards.filter((c) => c.column === column).sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Renumber a column's sortOrder to 0..n-1 so ordering can't drift. */
function renumber(cards: TaskCard[], column: ColumnId): TaskCard[] {
  let i = 0;
  const order = new Map(cardsByColumn(cards, column).map((c) => [c.id, i++]));
  return cards.map((c) => (order.has(c.id) ? { ...c, sortOrder: order.get(c.id)! } : c));
}

/** Append a card to the end of its column. */
export function addCard(cards: TaskCard[], input: NewCardInput): TaskCard[] {
  const column = input.column ?? 'backlog';
  const card = createCard(input, cardsByColumn(cards, column).length);
  return [...cards, card];
}

/**
 * Move a card to `toColumn`, inserted at `targetIndex` within that column
 * (appended when omitted). Both the source and target columns are renumbered,
 * so sortOrder stays dense and per-column — the previous implementation indexed
 * against a list filtered across every column, which let ordering drift.
 */
export function moveCard(
  cards: TaskCard[],
  cardId: string,
  toColumn: ColumnId,
  targetIndex?: number,
): TaskCard[] {
  const moving = cards.find((c) => c.id === cardId);
  if (!moving) return cards;

  const fromColumn = moving.column;
  const rest = cards.filter((c) => c.id !== cardId);
  const target = cardsByColumn(rest, toColumn);

  const at = targetIndex === undefined
    ? target.length
    : Math.max(0, Math.min(targetIndex, target.length));

  const updated = { ...moving, column: toColumn, updatedAt: Date.now() };
  target.splice(at, 0, updated);

  // Reassemble: untouched columns, then the freshly ordered target column.
  const others = rest.filter((c) => c.column !== toColumn);
  let out = [...others, ...target.map((c, i) => ({ ...c, sortOrder: i }))];
  if (fromColumn !== toColumn) out = renumber(out, fromColumn);
  return out;
}

export function removeCard(cards: TaskCard[], cardId: string): TaskCard[] {
  const card = cards.find((c) => c.id === cardId);
  if (!card) return cards;
  return renumber(cards.filter((c) => c.id !== cardId), card.column);
}

export function updateCard(cards: TaskCard[], cardId: string, updates: Partial<TaskCard>): TaskCard[] {
  return cards.map((c) => (c.id === cardId ? { ...c, ...updates, updatedAt: Date.now() } : c));
}
