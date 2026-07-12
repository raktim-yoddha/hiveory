import type { QueenBeeTask } from './types.js';

export interface ReviewResult {
  taskId: string;
  approved: boolean;
  feedback: string;
  updatedTask?: Partial<QueenBeeTask>;
}

export class ReviewRouter {
  route(result: ReviewResult): { action: 'reassign' | 'retry' | 'complete'; targetTaskId?: string } {
    if (result.approved) {
      return { action: 'complete' };
    }

    if (result.updatedTask) {
      return { action: 'reassign', targetTaskId: result.taskId };
    }

    return { action: 'retry', targetTaskId: result.taskId };
  }
}
