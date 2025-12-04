/**
 * Hybrid Scorer for Smart Links
 *
 * Combines TF-IDF and semantic scores with configurable weights
 * Provides unified scoring interface for link suggestions
 *
 * Semantic scoring can use:
 * 1. Neural embeddings (via EmbeddingEngine) - most accurate, optional
 * 2. N-gram + context vectors (via SemanticEngine) - fallback, always available
 */

import { NoteIndex, SmartLinksSettings } from '../types';
import { TFIDFEngine, TFIDFResult } from './tfidf-engine';
import { SemanticEngine, SemanticSimilarityResult } from './semantic-engine';
import { EmbeddingEngine } from './embedding-engine';
import { EmbeddingCache } from '../cache/embedding-cache';

export interface HybridResult {
  note: NoteIndex;
  tfidfScore: number;
  semanticScore?: number;  // Renamed from embeddingScore
  finalScore: number;
  matchedKeywords: string[];
  matchedPhrases?: string[];  // New: matched n-gram phrases
}

/**
 * Hybrid Scorer
 * Intelligently combines TF-IDF and semantic scores
 */
export class HybridScorer {
  private tfidfEngine: TFIDFEngine;
  private semanticEngine: SemanticEngine | null;
  private embeddingEngine: EmbeddingEngine | null;
  private embeddingCache: EmbeddingCache | null;
  private settings: SmartLinksSettings;

  constructor(
    tfidfEngine: TFIDFEngine,
    semanticEngine: SemanticEngine | null, // null when semantic engine not ready
    settings: SmartLinksSettings,
    embeddingEngine?: EmbeddingEngine | null,
    embeddingCache?: EmbeddingCache | null
  ) {
    this.tfidfEngine = tfidfEngine;
    this.semanticEngine = semanticEngine;
    this.embeddingEngine = embeddingEngine || null;
    this.embeddingCache = embeddingCache || null;
    this.settings = settings;

    const engines: string[] = ['TF-IDF'];
    if (embeddingEngine) engines.push('Neural Embeddings');
    if (semanticEngine) engines.push('N-gram/Context Semantic');
    console.log('[Smart Links] HybridScorer initialized with:', engines.join(' + '));
  }

  /**
   * Find similar notes using hybrid scoring
   * Combines TF-IDF and semantic similarity (if available)
   *
   * Priority for semantic scoring:
   * 1. Neural embeddings (if enabled and model loaded)
   * 2. N-gram + context vectors (if enabled and ready)
   * 3. TF-IDF only (always available)
   */
  async findSimilarNotes(
    sourceNote: NoteIndex,
    maxResults: number = 10
  ): Promise<HybridResult[]> {
    // Check if neural embeddings are available
    const neuralEmbeddingsReady = this.embeddingEngine?.isModelLoaded() &&
                                   this.embeddingCache &&
                                   this.settings.enableNeuralEmbeddings;

    // Check if n-gram/context semantic is available
    const semanticEngineReady = this.semanticEngine?.isModelReady() &&
                                this.settings.enableSemanticSearch;

    console.log('[HybridScorer] Available engines:', {
      neuralEmbeddings: neuralEmbeddingsReady,
      semanticEngine: semanticEngineReady,
      tfidf: true
    });

    // Priority: Neural embeddings > Semantic engine > TF-IDF only
    if (neuralEmbeddingsReady) {
      console.log('[HybridScorer] Using hybrid search (TF-IDF + Neural Embeddings)');
      return this.hybridSearchWithEmbeddings(sourceNote, maxResults);
    } else if (semanticEngineReady) {
      console.log('[HybridScorer] Using hybrid search (TF-IDF + N-gram/Context Semantic)');
      return this.hybridSearch(sourceNote, maxResults);
    } else {
      console.log('[HybridScorer] Using TF-IDF only search');
      return this.tfidfOnlySearch(sourceNote, maxResults);
    }
  }

  /**
   * TF-IDF only search (fast, always available)
   */
  private tfidfOnlySearch(sourceNote: NoteIndex, maxResults: number): HybridResult[] {
    console.log('[HybridScorer] TF-IDF search params:', {
      threshold: this.settings.tfidfThreshold,
      maxResults
    });

    const tfidfResults = this.tfidfEngine.findSimilarNotes(
      sourceNote,
      this.settings.tfidfThreshold,
      maxResults
    );

    console.log('[HybridScorer] TF-IDF engine returned', tfidfResults.length, 'results');
    if (tfidfResults.length > 0) {
      console.log('[HybridScorer] Top TF-IDF result:', {
        title: tfidfResults[0].note.title,
        score: tfidfResults[0].score,
        threshold: this.settings.tfidfThreshold
      });
    }

    const hybridResults = tfidfResults.map((result) => ({
      note: result.note,
      tfidfScore: result.score,
      semanticScore: undefined,
      finalScore: result.score, // TF-IDF score is the final score
      matchedKeywords: result.matchedKeywords,
      matchedPhrases: result.matchedPhrases  // Pass through phrases for content-based linking
    }));

    console.log('[HybridScorer] Returning', hybridResults.length, 'hybrid results from TF-IDF only search');
    return hybridResults;
  }

  /**
   * Hybrid search (TF-IDF + semantic)
   */
  private hybridSearch(sourceNote: NoteIndex, maxResults: number): HybridResult[] {
    // Safety check - should not be called if semantic engine is null
    if (!this.semanticEngine) {
      console.warn('[Smart Links] hybridSearch called but semantic engine not ready, falling back to TF-IDF');
      return this.tfidfOnlySearch(sourceNote, maxResults);
    }

    // Get TF-IDF results (use lower threshold to cast wider net)
    const tfidfResults = this.tfidfEngine.findSimilarNotes(
      sourceNote,
      this.settings.tfidfThreshold * 0.5, // Lower threshold for initial filtering
      maxResults * 3 // Get more candidates for re-ranking
    );

    console.log('[HybridScorer] TF-IDF candidates:', tfidfResults.length);

    // Get semantic results
    const semanticResults = this.semanticEngine.findSimilarNotes(
      sourceNote,
      this.settings.semanticThreshold * 0.5,
      maxResults * 3
    );

    console.log('[HybridScorer] Semantic candidates:', semanticResults.length);

    // Create a map of note paths to results
    const resultsMap = new Map<string, {
      note: NoteIndex;
      tfidfScore: number;
      semanticScore: number;
      matchedKeywords: string[];
      matchedPhrases: string[];
    }>();

    // Add TF-IDF results
    for (const result of tfidfResults) {
      resultsMap.set(result.note.path, {
        note: result.note,
        tfidfScore: result.score,
        semanticScore: 0,
        matchedKeywords: result.matchedKeywords,
        matchedPhrases: []
      });
    }

    // Add/update with semantic scores
    for (const result of semanticResults) {
      const existing = resultsMap.get(result.note.path);
      if (existing) {
        existing.semanticScore = result.score;
        existing.matchedPhrases = result.matchedPhrases;
      } else {
        resultsMap.set(result.note.path, {
          note: result.note,
          tfidfScore: 0,
          semanticScore: result.score,
          matchedKeywords: [],  // No TF-IDF match, so no keywords
          matchedPhrases: result.matchedPhrases
        });
      }
    }

    // Calculate hybrid scores
    const hybridResults: HybridResult[] = [];

    for (const result of resultsMap.values()) {
      const finalScore = this.calculateHybridScore(
        result.tfidfScore,
        result.semanticScore
      );

      // Determine appropriate threshold based on which scores are present
      let threshold: number;
      if (result.tfidfScore > 0 && result.semanticScore > 0) {
        // Both scores present: use combined threshold
        threshold = this.settings.combinedThreshold;
      } else if (result.tfidfScore > 0) {
        // Only TF-IDF: use TF-IDF threshold
        threshold = this.settings.tfidfThreshold;
      } else {
        // Only semantic: use semantic threshold
        threshold = this.settings.semanticThreshold;
      }

      // Filter by appropriate threshold
      if (finalScore >= threshold) {
        hybridResults.push({
          note: result.note,
          tfidfScore: result.tfidfScore,
          semanticScore: result.semanticScore,
          finalScore,
          matchedKeywords: result.matchedKeywords,
          matchedPhrases: result.matchedPhrases
        });
      }
    }

    // Sort by final score descending
    hybridResults.sort((a, b) => b.finalScore - a.finalScore);

    console.log('[HybridScorer] Merged candidates:', resultsMap.size, '-> After threshold filtering:', hybridResults.length);
    if (hybridResults.length > 0) {
      console.log('[HybridScorer] Top hybrid result:', {
        title: hybridResults[0].note.title,
        tfidf: hybridResults[0].tfidfScore.toFixed(4),
        semantic: hybridResults[0].semanticScore?.toFixed(4) ?? 'N/A',
        final: hybridResults[0].finalScore.toFixed(4)
      });
    }

    // Return top N results
    return hybridResults.slice(0, maxResults);
  }

  /**
   * Calculate combined score using configured weights
   *
   * When a note only has one type of score (the other is 0),
   * we use just that score directly to avoid penalizing notes
   * that only match in one dimension.
   */
  private calculateHybridScore(tfidfScore: number, semanticScore: number): number {
    const tfidfWeight = this.settings.tfidfWeight;
    const semanticWeight = this.settings.semanticWeight;

    // If only one score is present, use it directly (no penalty for missing score)
    if (tfidfScore > 0 && semanticScore === 0) {
      return tfidfScore;
    }
    if (semanticScore > 0 && tfidfScore === 0) {
      return semanticScore;
    }
    if (tfidfScore === 0 && semanticScore === 0) {
      return 0;
    }

    // Both scores present: use weighted average
    const totalWeight = tfidfWeight + semanticWeight;
    const normalizedTfidfWeight = tfidfWeight / totalWeight;
    const normalizedSemanticWeight = semanticWeight / totalWeight;

    return (tfidfScore * normalizedTfidfWeight) + (semanticScore * normalizedSemanticWeight);
  }

  /**
   * Hybrid search using neural embeddings
   * Uses EmbeddingEngine for semantic scoring
   */
  private async hybridSearchWithEmbeddings(
    sourceNote: NoteIndex,
    maxResults: number
  ): Promise<HybridResult[]> {
    if (!this.embeddingEngine || !this.embeddingCache) {
      console.warn('[HybridScorer] Embedding engine not ready, falling back');
      return this.hybridSearch(sourceNote, maxResults);
    }

    // Get TF-IDF results (use lower threshold to cast wider net)
    const tfidfResults = this.tfidfEngine.findSimilarNotes(
      sourceNote,
      this.settings.tfidfThreshold * 0.5,
      maxResults * 3
    );

    console.log('[HybridScorer] TF-IDF candidates:', tfidfResults.length);

    // Get or generate source embedding
    let sourceEmbedding = this.embeddingCache?.get(sourceNote.path);
    if (!sourceEmbedding) {
      try {
        const text = sourceNote.cleanContent || sourceNote.content;
        if (!text || text.trim().length === 0) {
          console.warn('[HybridScorer] Source note has no content for embedding');
          return this.hybridSearch(sourceNote, maxResults);
        }
        sourceEmbedding = await this.embeddingEngine.generateEmbedding(text);
      } catch (error) {
        console.warn('[HybridScorer] Failed to generate source embedding:', error);
        // Fall back to n-gram/context semantic or TF-IDF only
        if (this.semanticEngine?.isModelReady()) {
          return this.hybridSearch(sourceNote, maxResults);
        }
        return this.tfidfOnlySearch(sourceNote, maxResults);
      }
    }

    // Validate embedding was generated successfully
    if (!sourceEmbedding || sourceEmbedding.length === 0) {
      console.warn('[HybridScorer] Source embedding is invalid, falling back');
      if (this.semanticEngine?.isModelReady()) {
        return this.hybridSearch(sourceNote, maxResults);
      }
      return this.tfidfOnlySearch(sourceNote, maxResults);
    }

    // Get all cached embeddings (embeddingCache verified non-null earlier)
    const allEmbeddings = this.embeddingCache!.getAll();
    console.log('[HybridScorer] Total cached embeddings:', allEmbeddings.size);

    // CRITICAL: If no embeddings are cached, fall back to TF-IDF only search
    // This prevents the scenario where TF-IDF candidates are found with threshold*0.5
    // but then filtered out by the full threshold (since there are no embeddings to boost scores)
    if (allEmbeddings.size === 0) {
      console.log('[HybridScorer] No cached embeddings, falling back to TF-IDF only search');
      return this.tfidfOnlySearch(sourceNote, maxResults);
    }

    // Calculate embedding similarities for all notes with embeddings
    const embeddingSimilarities = this.embeddingEngine.findSimilarNotes(
      sourceEmbedding,
      allEmbeddings,
      maxResults * 3,
      new Set([sourceNote.path])
    );

    console.log('[HybridScorer] Embedding candidates:', embeddingSimilarities.length);

    // Create results map
    const resultsMap = new Map<string, {
      note: NoteIndex;
      tfidfScore: number;
      semanticScore: number;
      matchedKeywords: string[];
      matchedPhrases: string[];
    }>();

    // Add TF-IDF results
    for (const result of tfidfResults) {
      resultsMap.set(result.note.path, {
        note: result.note,
        tfidfScore: result.score,
        semanticScore: 0,
        matchedKeywords: result.matchedKeywords,
        matchedPhrases: result.matchedPhrases  // Pass through phrases
      });
    }

    // Add/update with embedding scores
    for (const embResult of embeddingSimilarities) {
      const note = this.tfidfEngine.getNote(embResult.notePath);
      if (!note) continue;

      const existing = resultsMap.get(embResult.notePath);
      if (existing) {
        existing.semanticScore = embResult.similarity;
      } else {
        resultsMap.set(embResult.notePath, {
          note,
          tfidfScore: 0,
          semanticScore: embResult.similarity,
          matchedKeywords: [],
          matchedPhrases: []
        });
      }
    }

    // Calculate hybrid scores and filter
    const hybridResults: HybridResult[] = [];

    for (const result of resultsMap.values()) {
      const finalScore = this.calculateHybridScore(
        result.tfidfScore,
        result.semanticScore
      );

      // Determine threshold based on which scores are present
      let threshold: number;
      if (result.tfidfScore > 0 && result.semanticScore > 0) {
        threshold = this.settings.combinedThreshold;
      } else if (result.tfidfScore > 0) {
        threshold = this.settings.tfidfThreshold;
      } else {
        threshold = this.settings.semanticThreshold;
      }

      if (finalScore >= threshold) {
        hybridResults.push({
          note: result.note,
          tfidfScore: result.tfidfScore,
          semanticScore: result.semanticScore,
          finalScore,
          matchedKeywords: result.matchedKeywords,
          matchedPhrases: result.matchedPhrases  // Pass through phrases for content-based linking
        });
      }
    }

    // Sort and return
    hybridResults.sort((a, b) => b.finalScore - a.finalScore);

    console.log('[HybridScorer] Neural hybrid results:', hybridResults.length);
    if (hybridResults.length > 0) {
      console.log('[HybridScorer] Top result:', {
        title: hybridResults[0].note.title,
        tfidf: hybridResults[0].tfidfScore.toFixed(4),
        embedding: hybridResults[0].semanticScore?.toFixed(4) ?? 'N/A',
        final: hybridResults[0].finalScore.toFixed(4)
      });
    }

    return hybridResults.slice(0, maxResults);
  }

  /**
   * Set the semantic engine (for lazy initialization)
   */
  setSemanticEngine(semanticEngine: SemanticEngine | null): void {
    this.semanticEngine = semanticEngine;
    console.log('[Smart Links] SemanticEngine', semanticEngine ? 'enabled' : 'disabled', 'in HybridScorer');
  }

  /**
   * Set the embedding engine and cache (for lazy initialization)
   */
  setEmbeddingEngine(
    embeddingEngine: EmbeddingEngine | null,
    embeddingCache: EmbeddingCache | null
  ): void {
    this.embeddingEngine = embeddingEngine;
    this.embeddingCache = embeddingCache;
    console.log('[Smart Links] EmbeddingEngine', embeddingEngine ? 'enabled' : 'disabled', 'in HybridScorer');
  }

  /**
   * Update settings
   */
  updateSettings(settings: SmartLinksSettings): void {
    this.settings = settings;
  }

  /**
   * Check if neural embeddings are available and ready
   */
  hasNeuralEmbeddings(): boolean {
    return !!(this.embeddingEngine?.isModelLoaded() && this.embeddingCache);
  }

  /**
   * Check if any semantic search is available
   */
  hasSemanticSearch(): boolean {
    return this.hasNeuralEmbeddings() || !!(this.semanticEngine?.isModelReady());
  }
}
