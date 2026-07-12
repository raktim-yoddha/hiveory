import { describe, it, expect } from 'vitest';
import { templateBreakdown, buildBreakdownPrompt, parseBreakdownResponse } from '../src/breakdown.js';

describe('templateBreakdown', () => {
  it('returns a task for auth-related goals', () => {
    const result = templateBreakdown('Add OAuth login');
    expect(result.tasks.length).toBeGreaterThan(0);
    expect(result.tasks[0].suggestedRole).toBe('builder');
    expect(result.tasks[0].owns).toContain('src/auth/');
  });

  it('returns a generic task for unknown goals', () => {
    const result = templateBreakdown('Refactor the database layer');
    expect(result.tasks.length).toBe(1);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe('buildBreakdownPrompt', () => {
  it('includes the goal and nectar context in the prompt', () => {
    const prompt = buildBreakdownPrompt({ goal: 'Fix all bugs', nectarContext: 'Project uses TypeScript' });
    expect(prompt).toContain('Fix all bugs');
    expect(prompt).toContain('Project uses TypeScript');
  });

  it('handles missing nectar context', () => {
    const prompt = buildBreakdownPrompt({ goal: 'Add tests' });
    expect(prompt).toContain('(no context loaded yet)');
  });
});

describe('parseBreakdownResponse', () => {
  it('parses a valid JSON array', () => {
    const raw = JSON.stringify([{ id: 'task-1', description: 'Test' }]);
    const result = parseBreakdownResponse(raw);
    expect(result.tasks.length).toBe(1);
    expect(result.warnings.length).toBe(0);
  });

  it('parses an object with tasks array', () => {
    const raw = JSON.stringify({ tasks: [{ id: 'task-1', description: 'Test' }] });
    const result = parseBreakdownResponse(raw);
    expect(result.tasks.length).toBe(1);
  });

  it('returns a warning for non-JSON input', () => {
    const result = parseBreakdownResponse('not json');
    expect(result.tasks.length).toBe(0);
    expect(result.warnings.length).toBe(1);
  });
});
