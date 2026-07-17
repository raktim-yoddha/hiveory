export type { WorktreeInfo, WorktreeOps } from '../ports.js';

/**
 * The concrete `execSync`/`node:fs` implementation lives in `../node.js` so that
 * importing the orchestration core never pulls Node built-ins into a browser
 * bundle. Node consumers get it from the package root.
 */
