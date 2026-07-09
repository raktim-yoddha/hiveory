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

  // Simple embedding function - in production, use a real embedding model
  private async embedText(text: string): Promise<number[]> {
    // For v1, we'll use a simple hash-based embedding
    // This is a placeholder - in production, use OpenAI embeddings or similar
    const embedding = new Array(384).fill(0);
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash) + text.charCodeAt(i);
      hash = hash & hash;
    }
    for (let i = 0; i < embedding.length; i++) {
      embedding[i] = Math.sin(hash * (i + 1)) * 0.1;
    }
    return embedding;
  }

  // Cosine similarity
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
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
