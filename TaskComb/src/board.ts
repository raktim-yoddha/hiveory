export type ColumnId = 'backlog' | 'todo' | 'in-progress' | 'review' | 'done';

export const COLUMNS: ColumnId[] = ['backlog', 'todo', 'in-progress', 'review', 'done'];

export interface TaskCard {
  id: string;
  title: string;
  description: string;
  column: ColumnId;
  owns: string[];
  reads: string[];
  dependsOn: string[];
  assignedRole?: string;
  assignedCli?: string;
  missionId?: string;
  agentId?: string;
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

  moveCard(cardId: string, toColumn: ColumnId): TaskCard | undefined {
    const card = this.cards.get(cardId);
    if (card) {
      card.column = toColumn;
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
    return Array.from(this.cards.values()).filter(c => c.column === column);
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
