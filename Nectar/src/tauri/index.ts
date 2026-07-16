import { invoke } from "@tauri-apps/api/core";
import type { InjectionContext, InjectionResult } from "../injection/index.js";

// ── Tauri IPC request/response types ──────────────────────────────────────
export interface NectarEnsureStructureRequest { project_path: string; }
export interface NectarEnsureStructureResponse { success: boolean; created_files: string[]; }

export interface NectarReadMemoryFileRequest { project_path: string; relative_path: string; }
export interface NectarReadMemoryFileResponse { content: string; frontmatter: any; file_type: string; }

export interface NectarWriteMemoryFileRequest { project_path: string; relative_path: string; content: string; frontmatter?: any; }
export interface NectarWriteMemoryFileResponse { success: boolean; path: string; }

export interface NectarListMemoryFilesRequest { project_path: string; }
export interface NectarListMemoryFilesResponse { files: string[]; }

export interface NectarParseMarkdownToChunksRequest { content: string; }
export interface ChunkInfo { text: string; heading?: string; chunk_index?: number; }
export interface NectarParseMarkdownToChunksResponse { chunks: ChunkInfo[]; }

export interface NectarIndexFileRequest { project_path: string; relative_path: string; }
export interface NectarIndexFileResponse { success: boolean; chunks_indexed: number; }

export interface NectarSearchRequest { project_path: string; query: string; limit?: number; min_score?: number; }
export interface NectarSearchResponse { results: Array<{ chunk: ChunkInfo; source_file: string; score: number }>; }

export interface NectarInjectRequest { project_path: string; task: string; open_files: string[]; git_diff?: string; max_tokens?: number; max_chunks?: number; min_score?: number; }
export interface InjectedChunk { content: string; source_file: string; score: number; }
export interface NectarInjectResponse { chunks: InjectedChunk[]; query: string; total_tokens: number; }

export interface NectarFormatContextRequest { agent_type: string; chunks: InjectedChunk[]; }
export interface NectarFormatContextResponse { formatted_text: string; }

export interface NectarLogSessionRequest { project_path: string; session_id: string; agent_type: string; task: string; query: string; chunks: InjectedChunk[]; total_tokens: number; title?: string; branch?: string; worktree_id?: string; message_count?: number; }
export interface NectarLogSessionResponse { success: boolean; log_path: string; }

export interface NectarListSessionsRequest { project_path: string; scope: 'worktree' | 'workspace' | 'all'; filter?: string; worktree_id?: string; workspace_id?: string; }
export interface NectarSessionEntry { id: string; agent_type: string; title: string; branch: string | null; worktree_id: string | null; message_count: number | null; total_tokens: number | null; timestamp: number | null; preview: string | null; }
export interface NectarListSessionsResponse { sessions: NectarSessionEntry[]; }

export interface NectarCloseRequest { project_path: string; }
export interface NectarCloseResponse { success: boolean; }

// ── Tauri Nectar API wrapper ──────────────────────────────────────────────
export class TauriNectar {
  private projectPath: string;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
  }

  static async create(projectPath: string): Promise<TauriNectar> {
    const nectar = new TauriNectar(projectPath);
    await nectar.ensureStructure();
    return nectar;
  }

  async ensureStructure(): Promise<NectarEnsureStructureResponse> {
    return await invoke<NectarEnsureStructureResponse>("nectar_ensure_structure", { req: { project_path: this.projectPath } });
  }

  async readMemoryFile(relativePath: string): Promise<NectarReadMemoryFileResponse> {
    return await invoke<NectarReadMemoryFileResponse>("nectar_read_memory_file", { req: { project_path: this.projectPath, relative_path: relativePath } });
  }

  async writeMemoryFile(relativePath: string, content: string, frontmatter?: any): Promise<NectarWriteMemoryFileResponse> {
    const result = await invoke<NectarWriteMemoryFileResponse>("nectar_write_memory_file", { req: { project_path: this.projectPath, relative_path: relativePath, content, frontmatter } });
    try { await this.indexFile(relativePath); } catch (e) { console.warn(`[Nectar] Failed to index ${relativePath} after write:`, e); }
    return result;
  }

  async listMemoryFiles(): Promise<NectarListMemoryFilesResponse> {
    return await invoke<NectarListMemoryFilesResponse>("nectar_list_memory_files", { req: { project_path: this.projectPath } });
  }

  async parseMarkdownToChunks(content: string): Promise<NectarParseMarkdownToChunksResponse> {
    return await invoke<NectarParseMarkdownToChunksResponse>("nectar_parse_markdown_to_chunks", { req: { content } });
  }

  async indexFile(relativePath: string): Promise<NectarIndexFileResponse> {
    return await invoke<NectarIndexFileResponse>("nectar_index_file", { req: { project_path: this.projectPath, relative_path: relativePath } });
  }

  async search(query: string, options?: { limit?: number; min_score?: number }): Promise<NectarSearchResponse> {
    return await invoke<NectarSearchResponse>("nectar_search", { req: { project_path: this.projectPath, query, limit: options?.limit, min_score: options?.min_score } });
  }

  async inject(task: string, openFiles: string[], gitDiff?: string, options?: { max_tokens?: number; max_chunks?: number; min_score?: number }): Promise<NectarInjectResponse> {
    return await invoke<NectarInjectResponse>("nectar_inject", { req: { project_path: this.projectPath, task, open_files: openFiles, git_diff: gitDiff, max_tokens: options?.max_tokens, max_chunks: options?.max_chunks, min_score: options?.min_score } });
  }

  async formatContext(agentType: string, chunks: InjectedChunk[]): Promise<NectarFormatContextResponse> {
    return await invoke<NectarFormatContextResponse>("nectar_format_context", { req: { agent_type: agentType, chunks } });
  }

  async logSession(sessionId: string, agentType: string, task: string, query: string, chunks: InjectedChunk[], totalTokens: number): Promise<NectarLogSessionResponse> {
    return await invoke<NectarLogSessionResponse>("nectar_log_session", { req: { project_path: this.projectPath, session_id: sessionId, agent_type: agentType, task, query, chunks, total_tokens: totalTokens } });
  }

  async listSessions(scope: 'worktree' | 'workspace' | 'all' = 'all', filter?: string, worktreeId?: string, workspaceId?: string): Promise<NectarListSessionsResponse> {
    return await invoke<NectarListSessionsResponse>("nectar_list_sessions", { req: { project_path: this.projectPath, scope, filter, worktree_id: worktreeId, workspace_id: workspaceId } });
  }

  async close(): Promise<NectarCloseResponse> {
    return await invoke<NectarCloseResponse>("nectar_close", { req: { project_path: this.projectPath } });
  }

  getMemoryManager(): TauriMemoryManager {
    return new TauriMemoryManager(this);
  }
}

// ── Memory manager wrapper ────────────────────────────────────────────────
export class TauriMemoryManager {
  private nectar: TauriNectar;

  constructor(nectar: TauriNectar) {
    this.nectar = nectar;
  }

  async ensureStructure(): Promise<void> { await this.nectar.ensureStructure(); }

  async readMemoryFile(relativePath: string): Promise<{ content: string; frontmatter?: any; type: string } | null> {
    try { const r = await this.nectar.readMemoryFile(relativePath); return { content: r.content, frontmatter: r.frontmatter, type: r.file_type }; } catch { return null; }
  }

  async writeMemoryFile(relativePath: string, content: string, frontmatter?: any): Promise<void> {
    await this.nectar.writeMemoryFile(relativePath, content, frontmatter);
  }

  async listMemoryFiles(): Promise<string[]> {
    return (await this.nectar.listMemoryFiles()).files;
  }

  async parseMarkdownToChunks(content: string): Promise<Array<{ text: string; heading?: string }>> {
    return (await this.nectar.parseMarkdownToChunks(content)).chunks;
  }
}

// Re-export shared injection types from the main Nectar package so Tauri
// consumers don't need to import from two paths for common types.
export type { InjectionContext, InjectionResult } from "../injection/index.js";
