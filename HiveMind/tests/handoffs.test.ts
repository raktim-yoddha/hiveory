import { describe, it, expect } from 'vitest';
import { formatHandoff, parseHandoff, HandoffManager } from '../src/core.js';
import type { HandoffFs } from '../src/core.js';

/** In-memory HandoffFs — proves the manager works with no filesystem at all. */
function memoryFs() {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  const fs: HandoffFs = {
    mkdir: async (d) => { dirs.add(d); },
    writeFile: async (f, c) => { files.set(f, c); },
    readFile: async (f) => {
      const v = files.get(f);
      if (v === undefined) throw new Error(`ENOENT: ${f}`);
      return v;
    },
    readDir: async (d) => {
      if (!dirs.has(d)) throw new Error(`ENOENT: ${d}`);
      return [...files.keys()].filter((f) => f.startsWith(d + '/')).map((f) => f.slice(d.length + 1));
    },
  };
  return { fs, files, dirs };
}

describe('handoff format', () => {
  it('round-trips an entry', () => {
    const entry = {
      taskId: 't1', role: 'builder', status: 'running',
      worktreePath: '/tmp/proj-t1', branchName: 'agent/t1',
      filesTouched: ['a.ts', 'b.ts'], summary: 'Add a thing',
      blocking: [], dependsOn: ['t0'], reviewerNotes: 'looks fine',
    };
    const parsed = parseHandoff(formatHandoff('t1', entry), 't1');
    expect(parsed).toEqual(entry);
  });

  it('encodes empty blocking/depends-on as "none" and reads them back empty', () => {
    const md = formatHandoff('t2', { role: 'builder', status: 'running', summary: 's' });
    expect(md).toContain('Blocking: none');
    const parsed = parseHandoff(md, 't2');
    expect(parsed.blocking).toEqual([]);
    expect(parsed.dependsOn).toEqual([]);
  });
});

describe('HandoffManager with an injected store', () => {
  it('writes and reads without any Node fs', async () => {
    const { fs } = memoryFs();
    const m = new HandoffManager('/proj', fs);
    await m.ensureStructure();
    await m.write('t1', { role: 'builder', status: 'running', summary: 'work' });

    const read = await m.read('t1');
    expect(read?.role).toBe('builder');
    expect(read?.summary).toBe('work');
  });

  it('returns null for a missing handoff rather than throwing', async () => {
    const { fs } = memoryFs();
    const m = new HandoffManager('/proj', fs);
    await expect(m.read('nope')).resolves.toBeNull();
  });

  it('lists handoffs for a mission', async () => {
    const { fs } = memoryFs();
    const m = new HandoffManager('/proj', fs);
    await m.ensureStructure();
    await m.write('m1-a', { status: 'running' });
    await m.write('m1-b', { status: 'running' });
    await m.write('m2-a', { status: 'running' });

    expect((await m.listByMission('m1')).sort()).toEqual(['m1-a', 'm1-b']);
  });
});
