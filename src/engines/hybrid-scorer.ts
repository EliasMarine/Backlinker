/**
 * Hybrid Scorer for Smart Links
 *
 * Combines TF-IDF and semantic scores with configurable weights
 * Provides unified scoring interface for link suggestions
 */

import { NoteIndex, SmartLinksSettings } from '../types';
import { TFIDFEngine, TFIDFResult } from './tfidf-engine';
import { SemanticEngine, SemanticSimilarityResult } from './semantic-engine';

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
  private settings: SmartLinksSettings;

  constructor(
    tfidfEngine: TFIDFEngine,
    semanticEngine: SemanticEngine | null, // null when semantic engine not ready
    settings: SmartLinksSettings
  ) {
    this.tfidfEngine = tfidfEngine;
    this.semanticEngine = semanticEngine;
    this.settings = settings;

    if (!semanticEngine) {
      console.log('[Smart Links] HybridScorer initialized with TF-IDF only (semantic engine not ready)');
    } else {
      console.log('[Smart Links] HybridScorer initialized with TF-IDF + Semantic engine');
    }
  }

  /**
   * Find similar notes using hybrid scoring
   * Combines TF-IDF and semantic similarity (if available)
   */
  async findSimilarNotes(
    sourceNote: NoteIndex,
    maxResults: number = 10
  ): Promise<HybridResult[]> {
    const semanticEngineExists = !!this.semanticEngine;
    const semanticModelReady = this.semanticEngine?.isModelReady() || false;
    const semanticSearchEnabled = this.settings.enableSemanticSearch;

    console.log('[HybridScorer] Semantic check:', {
      engineExists: semanticEngineExists,
      modelReady: semanticModelReady,
      searchEnabled: semanticSearchEnabled
    });

    const semanticEnabled = this.semanticEngine &&
                           this.semanticEngine.isModelReady() &&
                           this.settings.enableSemanticSearch;

    if (semanticEnabled) {
      console.log('[HybridScorer] Using hybrid search (TF-IDF + Semantic)');
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
      matchedPhrases: undefined
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
   * Set the semantic engine (for lazy initialization)
   */
  setSemanticEngine(semanticEngine: SemanticEngine | null): void {
    this.semanticEngine = semanticEngine;
    console.log('[Smart Links] SemanticEngine', semanticEngine ? 'enabled' : 'disabled', 'in HybridScorer');
  }

  /**
   * Update settings
   */
  updateSettings(settings: SmartLinksSettings) {
    this.settings = settings;
  }
}
