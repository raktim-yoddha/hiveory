import { invoke } from "@tauri-apps/api/core";

// Types matching Rust structs
export interface NectarEnsureStructureRequest {
  project_path: string;
}

export interface NectarEnsureStructureResponse {
  success: boolean;
  created_files: string[];
}

export interface NectarReadMemoryFileRequest {
  project_path: string;
  relative_path: string;
}

export interface NectarReadMemoryFileResponse {
  content: string;
  frontmatter: any;
  file_type: string;
}

export interface NectarWriteMemoryFileRequest {
  project_path: string;
  relative_path: string;
  content: string;
  frontmatter?: any;
}

export interface NectarWriteMemoryFileResponse {
  success: boolean;
  path: string;
}

export interface NectarListMemoryFilesRequest {
  project_path: string;
}

export interface NectarListMemoryFilesResponse {
  files: string[];
}

export interface NectarParseMarkdownToChunksRequest {
  content: string;
}

export interface ChunkInfo {
  text: string;
  heading?: string;
}

export interface NectarParseMarkdownToChunksResponse {
  chunks: ChunkInfo[];
}

export interface NectarIndexFileRequest {
  project_path: string;
  relative_path: string;
}

export interface NectarIndexFileResponse {
  success: boolean;
  chunks_indexed: number;
}

export interface NectarSearchRequest {
  project_path: string;
  query: string;
  limit?: number;
  min_score?: number;
}

export interface SearchResult {
  chunk: ChunkInfo;
  source_file: string;
  score: number;
}

export interface NectarSearchResponse {
  results: SearchResult[];
}

export interface NectarInjectRequest {
  project_path: string;
  task: string;
  open_files: string[];
  git_diff?: string;
  max_tokens?: number;
  max_chunks?: number;
  min_score?: number;
}

export interface InjectedChunk {
  content: string;
  source_file: string;
  score: number;
}

export interface NectarInjectResponse {
  chunks: InjectedChunk[];
  query: string;
  total_tokens: number;
}

export interface NectarFormatContextRequest {
  agent_type: string;
  chunks: InjectedChunk[];
}

export interface NectarFormatContextResponse {
  formatted_text: string;
}

export interface NectarLogSessionRequest {
  project_path: string;
  session_id: string;
  agent_type: string;
  task: string;
  query: string;
  chunks: InjectedChunk[];
  total_tokens: number;
}

export interface NectarLogSessionResponse {
  success: boolean;
  log_path: string;
}

export interface NectarCloseRequest {
  project_path: string;
}

export interface NectarCloseResponse {
  success: boolean;
}

// Nectar API wrapper class
export class Nectar {
  private projectPath: string;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
  }

  static async create(projectPath: string): Promise<Nectar> {
    const nectar = new Nectar(projectPath);
    await nectar.initialize();
    return nectar;
  }

  private async initialize(): Promise<void> {
    await this.ensureStructure();
  }

  async ensureStructure(): Promise<NectarEnsureStructureResponse> {
    const req: NectarEnsureStructureRequest = {
      project_path: this.projectPath,
    };
    return await invoke<NectarEnsureStructureResponse>("nectar_ensure_structure", { req });
  }

  async readMemoryFile(relativePath: string): Promise<NectarReadMemoryFileResponse> {
    const req: NectarReadMemoryFileRequest = {
      project_path: this.projectPath,
      relative_path: relativePath,
    };
    return await invoke<NectarReadMemoryFileResponse>("nectar_read_memory_file", { req });
  }

  async writeMemoryFile(
    relativePath: string,
    content: string,
    frontmatter?: any
  ): Promise<NectarWriteMemoryFileResponse> {
    const req: NectarWriteMemoryFileRequest = {
      project_path: this.projectPath,
      relative_path: relativePath,
      content,
      frontmatter,
    };
    return await invoke<NectarWriteMemoryFileResponse>("nectar_write_memory_file", { req });
  }

  async listMemoryFiles(): Promise<NectarListMemoryFilesResponse> {
    const req: NectarListMemoryFilesRequest = {
      project_path: this.projectPath,
    };
    return await invoke<NectarListMemoryFilesResponse>("nectar_list_memory_files", { req });
  }

  async parseMarkdownToChunks(content: string): Promise<NectarParseMarkdownToChunksResponse> {
    const req: NectarParseMarkdownToChunksRequest = {
      content,
    };
    return await invoke<NectarParseMarkdownToChunksResponse>("nectar_parse_markdown_to_chunks", { req });
  }

  async indexFile(relativePath: string): Promise<NectarIndexFileResponse> {
    const req: NectarIndexFileRequest = {
      project_path: this.projectPath,
      relative_path: relativePath,
    };
    return await invoke<NectarIndexFileResponse>("nectar_index_file", { req });
  }

  async search(query: string, options?: { limit?: number; min_score?: number }): Promise<NectarSearchResponse> {
    const req: NectarSearchRequest = {
      project_path: this.projectPath,
      query,
      limit: options?.limit,
      min_score: options?.min_score,
    };
    return await invoke<NectarSearchResponse>("nectar_search", { req });
  }

  async inject(
    task: string,
    openFiles: string[],
    gitDiff?: string,
    options?: { max_tokens?: number; max_chunks?: number; min_score?: number }
  ): Promise<NectarInjectResponse> {
    const req: NectarInjectRequest = {
      project_path: this.projectPath,
      task,
      open_files: openFiles,
      git_diff: gitDiff,
      max_tokens: options?.max_tokens,
      max_chunks: options?.max_chunks,
      min_score: options?.min_score,
    };
    return await invoke<NectarInjectResponse>("nectar_inject", { req });
  }

  async formatContext(agentType: string, chunks: InjectedChunk[]): Promise<NectarFormatContextResponse> {
    const req: NectarFormatContextRequest = {
      agent_type: agentType,
      chunks,
    };
    return await invoke<NectarFormatContextResponse>("nectar_format_context", { req });
  }

  async logSession(
    sessionId: string,
    agentType: string,
    task: string,
    query: string,
    chunks: InjectedChunk[],
    totalTokens: number
  ): Promise<NectarLogSessionResponse> {
    const req: NectarLogSessionRequest = {
      project_path: this.projectPath,
      session_id: sessionId,
      agent_type: agentType,
      task,
      query,
      chunks,
      total_tokens: totalTokens,
    };
    return await invoke<NectarLogSessionResponse>("nectar_log_session", { req });
  }

  async close(): Promise<NectarCloseResponse> {
    const req: NectarCloseRequest = {
      project_path: this.projectPath,
    };
    return await invoke<NectarCloseResponse>("nectar_close", { req });
  }

  getMemoryManager(): MemoryManager {
    return new MemoryManager(this);
  }
}

// Memory manager wrapper for compatibility with WorkerBees
export class MemoryManager {
  private nectar: Nectar;

  constructor(nectar: Nectar) {
    this.nectar = nectar;
  }

  async ensureStructure(): Promise<void> {
    await this.nectar.ensureStructure();
  }

  async readMemoryFile(relativePath: string): Promise<{ content: string; frontmatter?: any; type: string } | null> {
    try {
      const response = await this.nectar.readMemoryFile(relativePath);
      return {
        content: response.content,
        frontmatter: response.frontmatter,
        type: response.file_type,
      };
    } catch {
      return null;
    }
  }

  async writeMemoryFile(relativePath: string, content: string, frontmatter?: any): Promise<void> {
    await this.nectar.writeMemoryFile(relativePath, content, frontmatter);
  }

  async listMemoryFiles(): Promise<string[]> {
    const response = await this.nectar.listMemoryFiles();
    return response.files;
  }

  async parseMarkdownToChunks(content: string): Promise<Array<{ text: string; heading?: string }>> {
    const response = await this.nectar.parseMarkdownToChunks(content);
    return response.chunks;
  }
}

// Re-export types for compatibility
export interface InjectionContext {
  task: string;
  openFiles: string[];
  gitDiff?: string;
}

export interface InjectionResult {
  chunks: InjectedChunk[];
  query: string;
  total_tokens: number;
}
