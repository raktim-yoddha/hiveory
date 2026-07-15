export type ColumnId = 'backlog' | 'todo' | 'in-progress' | 'review' | 'done';

export const COLUMNS: ColumnId[] = ['backlog', 'todo', 'in-progress', 'review', 'done'];

export interface ColumnDefinition {
  id: ColumnId;
  title: string;
  color: string;
  icon: string;
}

export const DEFAULT_COLUMNS: ColumnDefinition[] = [
  { id: 'backlog', title: 'Backlog', color: 'neutral', icon: 'circle' },
  { id: 'todo', title: 'Todo', color: 'blue', icon: 'circle' },
  { id: 'in-progress', title: 'In Progress', color: 'conductor-progress', icon: 'conductor-progress' },
  { id: 'review', title: 'Review', color: 'conductor-review', icon: 'conductor-review' },
  { id: 'done', title: 'Done', color: 'conductor-done', icon: 'conductor-done' },
];

export interface TaskCard {
  id: string;
  title: string;
  description: string;
  column: ColumnId;
  sortOrder: number;
  owns: string[];
  reads: string[];
  dependsOn: string[];
  assignedRole?: string;
  assignedCli?: string;
  missionId?: string;
  workerBeeId?: string;
  worktreeBranch?: string;
  blockingReason?: string;
  createdAt: number;
  updatedAt: number;
}

export class Board {
  private cards = new Map<string, TaskCard>();

  addCard(card: Omit<TaskCard, 'createdAt' | 'updatedAt'>): TaskCard {
    const now = Date.now();
    const full: TaskCard = { ...card, createdAt: now, updatedAt: now };
    this.cards.set(card.id, full);
    return full;
  }

  moveCard(cardId: string, toColumn: ColumnId, sortOrder?: number): TaskCard | undefined {
    const card = this.cards.get(cardId);
    if (card) {
      card.column = toColumn;
      if (sortOrder !== undefined) card.sortOrder = sortOrder;
      card.updatedAt = Date.now();
    }
    return card;
  }

  getCard(cardId: string): TaskCard | undefined {
    return this.cards.get(cardId);
  }

  removeCard(cardId: string): boolean {
    return this.cards.delete(cardId);
  }

  getCardsByColumn(column: ColumnId): TaskCard[] {
    return Array.from(this.cards.values())
      .filter(c => c.column === column)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  getAllCards(): TaskCard[] {
    return Array.from(this.cards.values());
  }

  clear(): void {
    this.cards.clear();
  }

  updateCard(cardId: string, updates: Partial<TaskCard>): TaskCard | undefined {
    const card = this.cards.get(cardId);
    if (card) {
      Object.assign(card, updates, { updatedAt: Date.now() });
    }
    return card;
  }
}
