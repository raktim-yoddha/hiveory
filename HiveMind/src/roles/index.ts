export type Role = 'coordinator' | 'builder' | 'scout' | 'reviewer';

export interface RoleDefinition {
  id: Role;
  name: string;
  description: string;
  canWriteCode: boolean;
  needsWorktree: boolean;
}

const ROLE_DEFS: Record<Role, RoleDefinition> = {
  coordinator: {
    id: 'coordinator',
    name: 'Coordinator',
    description: 'Oversees mission task list, reacts to handoffs, decides sequencing. Does not write code.',
    canWriteCode: false,
    needsWorktree: false,
  },
  builder: {
    id: 'builder',
    name: 'Builder',
    description: 'Writes code for one task inside its own worktree.',
    canWriteCode: true,
    needsWorktree: true,
  },
  scout: {
    id: 'scout',
    name: 'Scout',
    description: 'Read-only exploration — investigates scope before a Builder is assigned. No write access.',
    canWriteCode: false,
    needsWorktree: false,
  },
  reviewer: {
    id: 'reviewer',
    name: 'Reviewer',
    description: 'Diffs branch against main, checks scope, approves or rejects with structured feedback.',
    canWriteCode: false,
    needsWorktree: true,
  },
};

export class RoleManager {
  getDefinition(role: Role): RoleDefinition {
    return ROLE_DEFS[role];
  }

  listRoles(): RoleDefinition[] {
    return Object.values(ROLE_DEFS);
  }
}
