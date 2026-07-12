import { NectarDatabase } from '../db/index.js';
import { Chunk } from '../db/schema.js';

export interface SearchResult {
  chunk: Chunk;
  score: number;
  source: 'vector' | 'keyword' | 'hybrid';
}

export interface SearchOptions {
  limit?: number;
  minScore?: number;
}

// Single source of truth for Nectar hybrid retrieval.
//
// IMPORTANT sql.js compatibility notes (this is why the code looks the way it
// does — see .nectar schema reality, not the idealised schema.ts):
//   1. The real nectar.db is created by the Rust backend and uses an FTS5
//      table (`chunks_fts`). The bundled sql.js build has NO fts5 module, so
//      we CANNOT query `chunks_fts` from JS. Instead we build an FTS4 mirror
//      (`chunks_fts4`) from the plain `chunks` table on demand — FTS4 IS
//      compiled into sql.js. This works no matter how the DB was created.
//   2. The `embedding` column is OPTIONAL. Older / keyword-only databases have
//      no `embedding` column at all, so vector search must degrade gracefully
//      to "no vector results" instead of throwing.
export class SearchEngine {
  private db: NectarDatabase;
  private ftsMirrorReady = false;
  private embeddingColumnChecked = false;
  private hasEmbeddingColumn = false;

  constructor(db: NectarDatabase) {
    this.db = db;
  }

  // Deterministic 384-dim character n-gram embedding (matches Rust backend).
  // No external model — just hash over (uni- bi- tri-)grams, L2-normalised.
  private embedText(text: string): number[] {
    const DIMS = 384;
    const vec = new Array(DIMS).fill(0);
    const chars = Array.from(text);

    // Trigram hits
    for (let i = 0; i < chars.length - 2; i++) {
      const idx = (chars[i].charCodeAt(0) * 31 + chars[i + 1].charCodeAt(0) * 7 + chars[i + 2].charCodeAt(0)) % DIMS;
      vec[idx] += 1.0;
    }
    // Bigram hits
    for (let i = 0; i < chars.length - 1; i++) {
      const idx = (chars[i].charCodeAt(0) * 31 + chars[i + 1].charCodeAt(0)) % DIMS;
      vec[idx] += 0.5;
    }
    // Unigram hits
    for (const c of chars) {
      const idx = c.charCodeAt(0) % DIMS;
      vec[idx] += 0.25;
    }

    // L2-normalise so cosine similarity = dot product
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    if (norm > 0) {
      for (let i = 0; i < DIMS; i++) vec[i] /= norm;
    }
    return vec;
  }

  // Cosine similarity (both vectors are L2-normalised, so this is just dot product)
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    const dot = a.reduce((s, v, i) => s + v * b[i], 0);
    return Math.max(0, Math.min(1, dot));
  }

  // Detect whether the `chunks` table actually has an `embedding` column.
  // Cached after first check. Rust-produced keyword-only DBs omit it.
  private embeddingColumnExists(): boolean {
    if (this.embeddingColumnChecked) return this.hasEmbeddingColumn;
    this.embeddingColumnChecked = true;
    this.hasEmbeddingColumn = false;
    try {
      const db = this.db.getDatabase();
      const stmt = db.prepare('PRAGMA table_info(chunks)');
      while (stmt.step()) {
        const row = stmt.getAsObject() as any;
        if (row.name === 'embedding') this.hasEmbeddingColumn = true;
      }
      stmt.free();
    } catch {
      this.hasEmbeddingColumn = false;
    }
    return this.hasEmbeddingColumn;
  }

  // Build (once per engine) an FTS4 mirror of the `chunks` table so keyword
  // search works even though sql.js can't read the Rust FTS5 table.
  //
  // When the DB was created by the JS schema (NectarDatabase.migrate →
  // initializeSchema), the schema already creates a chunks_fts4 table that the
  // triggers auto-populate — in that case we skip the full rebuild.  When the
  // DB was created by the Rust backend (which uses FTS5), the chunks_fts4 table
  // doesn't exist yet, so we create it and copy all rows once.
  private ensureFtsMirror(): void {
    if (this.ftsMirrorReady) return;
    this.ftsMirrorReady = true;
    const db = this.db.getDatabase();
    try {
      db.run('CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts4 USING fts4(content, source_file, chunk_index)');
      // If the FTS4 table already has rows (JS schema + triggers populated it),
      // skip the full rebuild — it's already in sync.
      try {
        const count = db.exec("SELECT COUNT(*) FROM chunks_fts4");
        if (count.length > 0 && parseInt(count[0].values[0][0] as string, 10) > 0) return;
      } catch { /* table just created — fall through to rebuild */ }
      // Rebuild from scratch — cheap for the small DB sizes Nectar handles,
      // and guarantees the mirror reflects the current `chunks` rows.
      try { db.run('DELETE FROM chunks_fts4'); } catch { /* table just created */ }
      db.run(
        `INSERT INTO chunks_fts4 (content, source_file, chunk_index)
         SELECT content, source_file, chunk_index FROM chunks`
      );
    } catch {
      // If even FTS4 is unavailable, keyword search will simply return [].
    }
  }

  // FTS5/FTS4 MATCH is picky about punctuation; strip characters that would
  // make the query a syntax error, and drop leading '-' (column filters).
  private sanitizeQuery(text: string): string {
    return text
      .replace(/"/g, ' ')
      .replace(/\(/g, ' ')
      .replace(/\)/g, ' ')
      .replace(/\*/g, ' ')
      .split(/\s+/)
      .map((w) => w.replace(/^-+/, ''))
      .filter((w) => w.length > 0)
      .join(' ');
  }

  private rowToChunk(row: any): Chunk {
    return {
      id: (row.id as string) ?? `${row.source_file}:${row.chunk_index}`,
      source_file: row.source_file as string,
      chunk_index: row.chunk_index as number,
      content: row.content as string,
      embedding: row.embedding ? Array.from(new Uint8Array(row.embedding)) : undefined,
      created_at: (row.created_at as number) ?? 0,
      updated_at: (row.updated_at as number) ?? 0,
    };
  }

  async vectorSearch(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const limit = options.limit || 10;
    const minScore = options.minScore || 0;

    // No embedding column -> no vector signal. Degrade gracefully.
    if (!this.embeddingColumnExists()) return [];

    const queryEmbedding = this.embedText(query);
    const db = this.db.getDatabase();

    const results: SearchResult[] = [];
    try {
      const stmt = db.prepare(
        `SELECT id, source_file, chunk_index, content, embedding, created_at, updated_at
         FROM chunks WHERE embedding IS NOT NULL`
      );
      while (stmt.step()) {
        const row = stmt.getAsObject() as any;
        if (!row.embedding) continue;
        const embeddingArray = new Float32Array(new Uint8Array(row.embedding).buffer);
        const score = this.cosineSimilarity(queryEmbedding, Array.from(embeddingArray));
        if (score >= minScore) {
          results.push({ chunk: this.rowToChunk(row), score, source: 'vector' });
        }
      }
      stmt.free();
    } catch {
      return [];
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  keywordSearch(query: string, options: SearchOptions = {}): SearchResult[] {
    const limit = options.limit || 10;
    const minScore = options.minScore || 0;
    const sanitized = this.sanitizeQuery(query);
    if (!sanitized) return [];

    this.ensureFtsMirror();
    const db = this.db.getDatabase();

    const results: SearchResult[] = [];
    try {
      // NOTE: the bundled sql.js FTS4 build does NOT expose bm25() (that is an
      // FTS5 function). We rank with matchinfo('pcx') instead, decoding the
      // per-term hit counts into a term-frequency relevance score. This is the
      // reason keyword ranking lives here and not via a raw bm25() call.
      const stmt = db.prepare(
        `SELECT content, source_file, chunk_index, matchinfo(chunks_fts4, 'pcx') as mi
         FROM chunks_fts4 WHERE chunks_fts4 MATCH ?
         LIMIT ?`
      );
      stmt.bind([sanitized, limit * 4]);
      while (stmt.step()) {
        const row = stmt.getAsObject() as any;
        const tf = this.matchinfoTermFrequency(row.mi as Uint8Array);
        // Fold raw term-frequency into a 0..1 relevance score.
        const relevance = tf > 0 ? 1.0 - 1.0 / (1.0 + tf) : 0;
        if (relevance >= minScore) {
          results.push({ chunk: this.rowToChunk(row), score: relevance, source: 'keyword' });
        }
      }
      stmt.free();
    } catch {
      // Malformed MATCH or missing mirror -> no keyword results.
      return [];
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  // Decode an FTS4 matchinfo('pcx') blob into a total term-frequency count for
  // the matched row. Layout (little-endian uint32):
  //   [0] = p (number of phrases)
  //   [1] = c (number of columns)
  //   then for each (phrase, column) pair, a triple:
  //     [hits in this row's column, total hits across all rows, docs with hits]
  // We sum the first element of each triple -> hits in this row.
  private matchinfoTermFrequency(blob: Uint8Array | undefined): number {
    if (!blob || blob.byteLength < 8) return 0;
    const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
    const u32 = (i: number) => view.getUint32(i * 4, true);
    const p = u32(0);
    const c = u32(1);
    let tf = 0;
    let idx = 2;
    for (let phrase = 0; phrase < p; phrase++) {
      for (let col = 0; col < c; col++) {
        if ((idx + 2) * 4 <= blob.byteLength) {
          tf += u32(idx); // hits of this phrase in this column of this row
        }
        idx += 3;
      }
    }
    return tf;
  }

  // Reciprocal Rank Fusion for hybrid search
  async hybridSearch(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const limit = options.limit || 10;
    const minScore = options.minScore || 0;
    const k = 60; // RRF constant

    const [vectorResults, keywordResults] = await Promise.all([
      this.vectorSearch(query, options),
      Promise.resolve(this.keywordSearch(query, options)),
    ]);

    const scores = new Map<string, number>();
    const keyFor = (r: SearchResult) => `${r.chunk.source_file}:${r.chunk.chunk_index}`;

    vectorResults.forEach((result, index) => {
      const key = keyFor(result);
      scores.set(key, (scores.get(key) || 0) + 1 / (k + index + 1));
    });
    keywordResults.forEach((result, index) => {
      const key = keyFor(result);
      scores.set(key, (scores.get(key) || 0) + 1 / (k + index + 1));
    });

    const uniqueChunks = new Map<string, Chunk>();
    for (const r of vectorResults.concat(keywordResults)) {
      const key = keyFor(r);
      if (!uniqueChunks.has(key)) uniqueChunks.set(key, r.chunk);
    }

    const results: SearchResult[] = [];
    for (const [key, chunk] of uniqueChunks) {
      const score = scores.get(key) || 0;
      if (score >= minScore) {
        results.push({ chunk, score, source: 'hybrid' });
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}
