import initSqlJs from 'sql.js';

export interface Chunk {
  id: string;
  source_file: string;
  chunk_index: number;
  content: string;
  // Optional: Rust-produced keyword-only DBs omit the embedding column.
  embedding?: number[];
  // Optional: present in Rust-produced DBs (heading of the source section).
  heading?: string;
  created_at: number;
  updated_at: number;
}

export interface MemoryFile {
  id: string;
  path: string;
  type: 'memory' | 'agent_session' | 'agent_summary' | 'handoff' | 'task_state';
  created_at: number;
  updated_at: number;
}

export function initializeSchema(db: initSqlJs.Database): void {
  // Metadata table
  db.run(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  // Memory files table
  db.run(`
    CREATE TABLE IF NOT EXISTS memory_files (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // Chunks table with vector storage
  db.run(`
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      source_file TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      embedding BLOB,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (source_file) REFERENCES memory_files(path) ON DELETE CASCADE
    )
  `);

  // FTS5 virtual table for keyword search
  db.run(`
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      content,
      source_file,
      chunk_index,
      content_rowid=rowid
    )
  `);

  // Triggers to keep FTS in sync
  db.run(`
    CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
      INSERT INTO chunks_fts(rowid, content, source_file, chunk_index)
      VALUES (new.rowid, new.content, new.source_file, new.chunk_index);
    END;

    CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
      DELETE FROM chunks_fts WHERE rowid = old.rowid;
    END;

    CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
      UPDATE chunks_fts SET content = new.content, source_file = new.source_file, chunk_index = new.chunk_index
      WHERE rowid = new.rowid;
    END;
  `);

  // Indexes for better query performance
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_chunks_source_file ON chunks(source_file);
    CREATE INDEX IF NOT EXISTS idx_memory_files_type ON memory_files(type);
  `);
}

export function getSchemaVersion(db: initSqlJs.Database): number {
  try {
    const stmt = db.prepare('SELECT value FROM metadata WHERE key = ?');
    stmt.bind(['schema_version']);
    const result = stmt.getAsObject() as { value: string } | undefined;
    stmt.free();
    return result && result.value ? parseInt(result.value, 10) : 0;
  } catch {
    // No metadata table yet (e.g. a Rust-produced DB) -> treat as version 0.
    return 0;
  }
}

export function setSchemaVersion(db: initSqlJs.Database, version: number): void {
  const stmt = db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)');
  stmt.bind(['schema_version', version.toString()]);
  stmt.run();
  stmt.free();
}
