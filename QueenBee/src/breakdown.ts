import type { QueenBeeTask, BreakdownResult } from './types.js';

export interface BreakdownInput {
  goal: string;
  nectarContext?: string;
  modelName?: string;
}

export async function breakdown(input: BreakdownInput): Promise<BreakdownResult> {
  const prompt = buildBreakdownPrompt(input);

  const result = templateBreakdown(input.goal);
  return {
    goal: input.goal,
    tasks: result.tasks,
    warnings: [
      ...result.warnings,
      'LLM-based breakdown not available — used template breakdown instead.',
    ],
  };
}

export function buildBreakdownPrompt(input: BreakdownInput): string {
  return `You are QueenBee, a planning agent for the Hiveory system.

Your job: take a human's goal and break it into tasks that can be executed in parallel by different AI coding agents.

Constraints:
- Each task must declare which files it owns (will write to)
- Each task must declare which files it reads (needs for context only)
- Tasks with overlapping owned files must be sequenced (depends-on)
- Each task gets a role: builder (writes code), scout (investigates), reviewer (checks work)
- Do NOT make tasks too large (one agent turn worth of work) or too small (busywork)

Project context from Nectar memory:
${input.nectarContext || '(no context loaded yet)'}

Human goal: ${input.goal}

Respond with a JSON array of tasks, each with:
{
  "id": "task-1",
  "description": "Implement OAuth login flow",
  "owns": ["src/auth/oauth.ts", "src/auth/session.ts"],
  "reads": ["src/config.ts", "src/db/schema.ts"],
  "dependsOn": [],
  "suggestedRole": "builder",
  "suggestedCli": "opencode"
}`;
}

export function parseBreakdownResponse(raw: string): { tasks: any[]; warnings: string[] } {
  try {
    const parsed = JSON.parse(raw);
    const tasks = Array.isArray(parsed) ? parsed : parsed.tasks || [];
    return { tasks, warnings: [] };
  } catch {
    return { tasks: [], warnings: ['Could not parse breakdown. LLM returned non-JSON response.'] };
  }
}

export function templateBreakdown(goal: string): { tasks: QueenBeeTask[]; warnings: string[] } {
  const warnings: string[] = [];
  const tasks: QueenBeeTask[] = [];

  if (goal.toLowerCase().includes('auth') || goal.toLowerCase().includes('login')) {
    tasks.push({
      id: 'task-auth-1',
      description: 'Implement authentication logic (OAuth/JWT/session)',
      owns: ['src/auth/'],
      reads: ['src/config.ts'],
      dependsOn: [],
      suggestedRole: 'builder',
      suggestedCli: 'opencode',
    });
  }

  if (tasks.length === 0) {
    tasks.push({
      id: 'task-1',
      description: goal,
      owns: ['src/'],
      reads: [],
      dependsOn: [],
      suggestedRole: 'builder',
      suggestedCli: 'opencode',
    });
    warnings.push('Generic breakdown — no specific pattern matched. LLM-based breakdown recommended.');
  }

  return { tasks, warnings };
}
