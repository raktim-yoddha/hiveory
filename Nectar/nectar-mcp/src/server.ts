#!/usr/bin/env node
// Nectar MCP server — exposes `nectar_query` as an MCP tool over stdio.
//
// Spawned by MCP-capable CLIs (OpenCode, Claude Code, Codex, Kilo Code, Cline)
// per the per-CLI configs in ./cli-configs/*. All retrieval is delegated to
// the shared `@hiveory/nectar` package via ./tools/nectar-query — this server
// contains NO retrieval logic of its own.
import { createInterface } from 'node:readline';
import { NECTAR_QUERY_TOOL, runNectarQuery } from './tools/nectar-query.js';

function parseProjectPath(argv: string[]): string {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project' && i + 1 < argv.length) return argv[i + 1];
  }
  return '';
}

function send(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

interface JsonRpcMessage {
  id?: number | string | null;
  method?: string;
  params?: any;
}

async function handleRequest(msg: JsonRpcMessage, projectPath: string): Promise<unknown | null> {
  const { id, method, params } = msg;

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'nectar-mcp', version: '0.1.0' },
      },
    };
  }

  if (method === 'notifications/initialized') {
    return null; // notification: no response
  }

  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: [NECTAR_QUERY_TOOL] } };
  }

  if (method === 'tools/call') {
    const toolName = params?.name;
    const args = params?.arguments || {};

    if (toolName === 'nectar_query') {
      try {
        const result = await runNectarQuery(projectPath, args);
        return {
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: result.text }] },
        };
      } catch (e) {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: `nectar_query failed: ${(e as Error).message}` }],
            isError: true,
          },
        };
      }
    }

    return {
      jsonrpc: '2.0',
      id,
      result: { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true },
    };
  }

  return {
    jsonrpc: '2.0',
    id: id ?? null,
    result: { content: [{ type: 'text', text: `Unknown method: ${method}` }], isError: true },
  };
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const projectPath = parseProjectPath(argv);
  if (!projectPath) {
    process.stderr.write('Usage: nectar-mcp --project <project-path>\n');
    process.exit(1);
  }

  process.stderr.write(`[nectar-mcp] started for project: ${projectPath}\n`);

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line) as JsonRpcMessage;
      const response = await handleRequest(msg, projectPath);
      if (response) send(response);
    } catch (e) {
      process.stderr.write(`[nectar-mcp] parse error: ${e}\n`);
    }
  }

  process.stderr.write('[nectar-mcp] exiting\n');
}

// Only run the loop when executed directly (not when imported by a test).
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('server.js') || process.argv[1].endsWith('server.ts'));
if (isDirectRun) {
  main().catch((e) => {
    process.stderr.write(`[nectar-mcp] fatal: ${e}\n`);
    process.exit(1);
  });
}
