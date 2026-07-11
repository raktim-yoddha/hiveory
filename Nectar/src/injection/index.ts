import { SearchEngine, SearchResult } from '../search';
import { MemoryManager } from '../memory';

export interface InjectionContext {
  task: string;
  openFiles: string[];
  gitDiff?: string;
}

export interface InjectionResult {
  chunks: Array<{
    content: string;
    sourceFile: string;
    score: number;
  }>;
  query: string;
  totalTokens: number;
}

export interface InjectionConfig {
  maxTokens?: number;
  minScore?: number;
  maxChunks?: number;
}

export class InjectionPipeline {
  private searchEngine: SearchEngine;
  private memoryManager: MemoryManager;
  private config: Required<InjectionConfig>;

  constructor(
    searchEngine: SearchEngine,
    memoryManager: MemoryManager,
    config: InjectionConfig = {}
  ) {
    this.searchEngine = searchEngine;
    this.memoryManager = memoryManager;
    this.config = {
      maxTokens: config.maxTokens || 4000,
      minScore: config.minScore || 0.1,
      maxChunks: config.maxChunks || 10,
    };
  }

  // Build a retrieval query from context
  buildQuery(context: InjectionContext): string {
    const parts: string[] = [];
    
    parts.push(context.task);
    
    if (context.openFiles.length > 0) {
      parts.push('Files: ' + context.openFiles.join(', '));
    }
    
    if (context.gitDiff) {
      parts.push('Recent changes: ' + context.gitDiff.substring(0, 500));
    }
    
    return parts.join('\n');
  }

  // Estimate token count (rough approximation: 1 token ≈ 4 characters)
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  async inject(context: InjectionContext): Promise<InjectionResult> {
    const query = this.buildQuery(context);
    const results = await this.searchEngine.hybridSearch(query, {
      limit: this.config.maxChunks * 2, // Get more than needed, then filter
      minScore: this.config.minScore,
    });
    
    const selectedChunks: Array<{
      content: string;
      sourceFile: string;
      score: number;
    }> = [];
    
    let totalTokens = 0;
    
    for (const result of results) {
      const chunkTokens = this.estimateTokens(result.chunk.content);
      
      if (totalTokens + chunkTokens > this.config.maxTokens) {
        break;
      }
      
      selectedChunks.push({
        content: result.chunk.content,
        sourceFile: result.chunk.source_file,
        score: result.score,
      });
      
      totalTokens += chunkTokens;
    }
    
    return {
      chunks: selectedChunks,
      query,
      totalTokens,
    };
  }

  // Format injection for different agent types
  formatForAgent(result: InjectionResult, agentType: 'claude' | 'codex' | 'aider' | 'antigravity' | 'agy'): string {
    if (result.chunks.length === 0) {
      return '';
    }
    
    const header = `# Project Context from Nectar\n\nQuery: ${result.query}\n\n`;
    const chunks = result.chunks
      .map((c, i) => `## Context ${i + 1} (score: ${c.score.toFixed(3)})\nSource: ${c.sourceFile}\n\n${c.content}`)
      .join('\n\n---\n\n');
    
    return header + chunks;
  }

  // Log injection to agent session file
  async logInjection(result: InjectionResult, agentType: string, sessionId: string): Promise<void> {
    const logContent = `# Injection Log\n\nAgent: ${agentType}\nSession: ${sessionId}\nQuery: ${result.query}\n\n## Retrieved Chunks\n\n${result.chunks
      .map((c, i) => `${i + 1}. ${c.sourceFile} (score: ${c.score.toFixed(3)})\n   Tokens: ~${this.estimateTokens(c.content)}`)
      .join('\n')}\n\nTotal Tokens: ${result.totalTokens}\n`;
    
    await this.memoryManager.writeMemoryFile(
      `agents/sessions/${sessionId}.md`,
      logContent,
      { type: 'injection_log', agent: agentType, timestamp: Date.now() }
    );
  }
}
