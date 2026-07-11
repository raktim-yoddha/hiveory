import { NectarDatabase } from '../db';
import { Chunk } from '../db/schema';

export interface SearchResult {
  chunk: Chunk;
  score: number;
  source: 'vector' | 'keyword' | 'hybrid';
}

export interface SearchOptions {
  limit?: number;
  minScore?: number;
}

export class SearchEngine {
  private db: NectarDatabase;

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

  async vectorSearch(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const limit = options.limit || 10;
    const minScore = options.minScore || 0;
    
    const queryEmbedding = await this.embedText(query);
    const db = this.db.getDatabase();
    
    const stmt = db.prepare(`
      SELECT id, source_file, chunk_index, content, embedding, created_at, updated_at
      FROM chunks
    `);
    const chunks: Chunk[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as any;
      chunks.push({
        id: row.id as string,
        source_file: row.source_file as string,
        chunk_index: row.chunk_index as number,
        content: row.content as string,
        embedding: row.embedding ? Array.from(new Uint8Array(row.embedding)) : undefined,
        created_at: row.created_at as number,
        updated_at: row.updated_at as number,
      });
    }
    stmt.free();
    
    const results: SearchResult[] = [];
    
    for (const chunk of chunks) {
      if (chunk.embedding) {
        const embeddingArray = new Float32Array(chunk.embedding);
        const score = this.cosineSimilarity(queryEmbedding, Array.from(embeddingArray));
        
        if (score >= minScore) {
          results.push({
            chunk,
            score,
            source: 'vector',
          });
        }
      }
    }
    
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  keywordSearch(query: string, options: SearchOptions = {}): SearchResult[] {
    const limit = options.limit || 10;
    const minScore = options.minScore || 0;
    const db = this.db.getDatabase();
    
    const stmt = db.prepare(`
      SELECT 
        c.id, c.source_file, c.chunk_index, c.content, c.embedding, c.created_at, c.updated_at,
        bm25(chunks_fts) as score
      FROM chunks_fts
      JOIN chunks c ON chunks_fts.content_rowid = c.rowid
      WHERE chunks_fts MATCH ?
      ORDER BY score
      LIMIT ?
    `);
    stmt.bind([query, limit]);
    
    const results: SearchResult[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as any;
      const score = row.score as number;
      if (score >= minScore) {
        results.push({
          chunk: {
            id: row.id as string,
            source_file: row.source_file as string,
            chunk_index: row.chunk_index as number,
            content: row.content as string,
            embedding: row.embedding ? Array.from(new Uint8Array(row.embedding)) : undefined,
            created_at: row.created_at as number,
            updated_at: row.updated_at as number,
          },
          score,
          source: 'keyword' as const,
        });
      }
    }
    stmt.free();
    
    return results;
  }

  // Reciprocal Rank Fusion for hybrid search
  async hybridSearch(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const limit = options.limit || 10;
    const minScore = options.minScore || 0;
    const k = 60; // RRF constant
    
    const [vectorResults, keywordResults] = await Promise.all([
      this.vectorSearch(query, options),
      this.keywordSearch(query, options),
    ]);
    
    const scores = new Map<string, number>();
    
    // Score vector results
    vectorResults.forEach((result, index) => {
      const score = 1 / (k + index + 1);
      scores.set(result.chunk.id, (scores.get(result.chunk.id) || 0) + score);
    });
    
    // Score keyword results
    keywordResults.forEach((result, index) => {
      const score = 1 / (k + index + 1);
      scores.set(result.chunk.id, (scores.get(result.chunk.id) || 0) + score);
    });
    
    // Combine and sort
    const combined = vectorResults.concat(keywordResults);
    const uniqueChunks = new Map(combined.map(r => [r.chunk.id, r.chunk]));
    
    const results: SearchResult[] = [];
    for (const [id, chunk] of uniqueChunks) {
      const score = scores.get(id) || 0;
      if (score >= minScore) {
        results.push({ chunk, score, source: 'hybrid' });
      }
    }
    
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
