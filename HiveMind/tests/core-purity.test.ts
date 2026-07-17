import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** Every .ts under src/, recursively. */
function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? sources(p) : p.endsWith('.ts') ? [p] : [];
  });
}

/**
 * The orchestration core has to run in the Tauri renderer, which has no Node
 * built-ins. `node.ts` is the one sanctioned place for them — if a `node:`
 * import leaks anywhere else, the desktop app's bundle breaks at runtime.
 */
describe('core purity', () => {
  const files = sources(SRC).filter((f) => path.basename(f) !== 'node.ts');

  it('finds the source tree', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files.map((f) => path.relative(SRC, f)))('%s has no node: imports', (rel) => {
    const code = fs.readFileSync(path.join(SRC, rel), 'utf-8');
    // Ignore the ports.ts doc comment that mentions node: in prose.
    const imports = code.match(/(?:from|import)\s*\(?\s*['"]node:[^'"]+['"]/g) ?? [];
    expect(imports).toEqual([]);
  });

  it('node.ts is the only file allowed to touch Node built-ins', () => {
    const nodeFile = fs.readFileSync(path.join(SRC, 'node.ts'), 'utf-8');
    expect(nodeFile).toMatch(/from 'node:/);
  });
});
