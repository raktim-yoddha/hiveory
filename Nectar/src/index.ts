import { NectarDatabase } from './db/index.js';
import { MemoryManager } from './memory/index.js';
import { SearchEngine } from './search/index.js';
import { InjectionPipeline, InjectionConfig, InjectionContext } from './injection/index.js';

export class Nectar {
  private db: NectarDatabase;
  private memoryManager: MemoryManager;
  private searchEngine: SearchEngine;
  private injectionPipeline: InjectionPipeline;

  private constructor(projectPath: string, db: NectarDatabase) {
    this.db = db;
    this.memoryManager = new MemoryManager(this.db, projectPath);
    this.searchEngine = new SearchEngine(this.db);
    this.injectionPipeline = new InjectionPipeline(this.searchEngine, this.memoryManager);
  }

  static async create(projectPath: string): Promise<Nectar> {
    const db = await NectarDatabase.create(projectPath);
    const nectar = new Nectar(projectPath, db);
    await nectar.initialize();
    return nectar;
  }

  private async initialize(): Promise<void> {
    await this.memoryManager.ensureStructure();
  }

  // Memory operations
  getMemoryManager(): MemoryManager {
    return this.memoryManager;
  }

  // Search operations
  async search(query: string, options?: { limit?: number; minScore?: number }) {
    return this.searchEngine.hybridSearch(query, options);
  }

  // Injection operations
  async inject(context: InjectionContext, config?: InjectionConfig) {
    const pipeline = config 
      ? new InjectionPipeline(this.searchEngine, this.memoryManager, config)
      : this.injectionPipeline;
    return pipeline.inject(context);
  }

  // Index a memory file
  async indexFile(relativePath: string): Promise<void> {
    const memoryFile = await this.memoryManager.readMemoryFile(relativePath);
    if (!memoryFile) return;

    const chunks = await this.memoryManager.parseMarkdownToChunks(memoryFile.content);
    const db = this.db.getDatabase();

    // Delete existing chunks for this file
    const deleteStmt = db.prepare('DELETE FROM chunks WHERE source_file = ?');
    deleteStmt.bind([relativePath]);
    deleteStmt.run();
    deleteStmt.free();

    const now = Date.now();
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = await this.searchEngine['embedText'](chunk.text);
      const embeddingBuffer = new Float32Array(embedding).buffer;
      
      const insertStmt = db.prepare(`
        INSERT INTO chunks (id, source_file, chunk_index, content, embedding, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      insertStmt.bind([
        `${relativePath}:${i}:${now}`,
        relativePath,
        i,
        chunk.text,
        new Uint8Array(embeddingBuffer),
        now,
        now
      ]);
      insertStmt.run();
      insertStmt.free();
    }

    // Update or insert memory file record
    const upsertStmt = db.prepare(`
      INSERT OR REPLACE INTO memory_files (id, path, type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    upsertStmt.bind([
      relativePath,
      relativePath,
      memoryFile.type,
      now,
      now
    ]);
    upsertStmt.run();
    upsertStmt.free();
  }

  // Re-index all memory files
  async reindexAll(): Promise<void> {
    const memoryFiles = await this.memoryManager.listMemoryFiles();
    for (const file of memoryFiles) {
      await this.indexFile(file);
    }
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}

export * from './db/index.js';
export * from './memory/index.js';
export * from './search/index.js';
export * from './injection/index.js';
