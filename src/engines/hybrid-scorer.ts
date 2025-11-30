/**
 * Hybrid Scorer for Smart Links
 *
 * Combines TF-IDF and embedding scores with configurable weights
 * Provides unified scoring interface for link suggestions
 */

import { NoteIndex, SmartLinksSettings } from '../types';
import { TFIDFEngine, TFIDFResult } from './tfidf-engine';
import { EmbeddingEngine, EmbeddingResult } from './embedding-engine';

export interface HybridResult {
  note: NoteIndex;
  tfidfScore: number;
  embeddingScore?: number;
  finalScore: number;
  matchedKeywords: string[];
}

/**
 * Hybrid Scorer
 * Intelligently combines TF-IDF and embedding scores
 */
export class HybridScorer {
  private tfidfEngine: TFIDFEngine;
  private embeddingEngine: EmbeddingEngine;
  private settings: SmartLinksSettings;

  constructor(
    tfidfEngine: TFIDFEngine,
    embeddingEngine: EmbeddingEngine,
    settings: SmartLinksSettings
  ) {
    this.tfidfEngine = tfidfEngine;
    this.embeddingEngine = embeddingEngine;
    this.settings = settings;
  }

  /**
   * Find similar notes using hybrid scoring
   * Combines TF-IDF and embeddings (if enabled)
   */
  async findSimilarNotes(
    sourceNote: NoteIndex,
    maxResults: number = 10
  ): Promise<HybridResult[]> {
    const embeddingsEnabled = this.settings.enableEmbeddings && sourceNote.embedding;

    if (embeddingsEnabled) {
      return this.hybridSearch(sourceNote, maxResults);
    } else {
      return this.tfidfOnlySearch(sourceNote, maxResults);
    }
  }

  /**
   * TF-IDF only search (fast, always available)
   */
  private tfidfOnlySearch(sourceNote: NoteIndex, maxResults: number): HybridResult[] {
    const tfidfResults = this.tfidfEngine.findSimilarNotes(
      sourceNote,
      this.settings.tfidfThreshold,
      maxResults
    );

    return tfidfResults.map((result) => ({
      note: result.note,
      tfidfScore: result.score,
      embeddingScore: undefined,
      finalScore: result.score, // TF-IDF score is the final score
      matchedKeywords: result.matchedKeywords
    }));
  }

  /**
   * Hybrid search (TF-IDF + embeddings)
   */
  private hybridSearch(sourceNote: NoteIndex, maxResults: number): HybridResult[] {
    // Get TF-IDF results (use lower threshold to cast wider net)
    const tfidfResults = this.tfidfEngine.findSimilarNotes(
      sourceNote,
      this.settings.tfidfThreshold * 0.5, // Lower threshold for initial filtering
      maxResults * 3 // Get more candidates for re-ranking
    );

    // Get embedding results
    const embeddingResults = this.embeddingEngine.findSimilarNotes(
      sourceNote,
      this.settings.embeddingThreshold * 0.5,
      maxResults * 3
    );

    // Create a map of note paths to results
    const resultsMap = new Map<string, {
      note: NoteIndex;
      tfidfScore: number;
      embeddingScore: number;
      matchedKeywords: string[];
    }>();

    // Add TF-IDF results
    for (const result of tfidfResults) {
      resultsMap.set(result.note.path, {
        note: result.note,
        tfidfScore: result.score,
        embeddingScore: 0,
        matchedKeywords: result.matchedKeywords
      });
    }

    // Add/update with embedding scores
    for (const result of embeddingResults) {
      const existing = resultsMap.get(result.note.path);
      if (existing) {
        existing.embeddingScore = result.score;
      } else {
        resultsMap.set(result.note.path, {
          note: result.note,
          tfidfScore: 0,
          embeddingScore: result.score,
          matchedKeywords: [] // No TF-IDF match, so no keywords
        });
      }
    }

    // Calculate hybrid scores
    const hybridResults: HybridResult[] = [];

    for (const result of resultsMap.values()) {
      const finalScore = this.calculateHybridScore(
        result.tfidfScore,
        result.embeddingScore
      );

      // Filter by combined threshold
      if (finalScore >= this.settings.combinedThreshold) {
        hybridResults.push({
          note: result.note,
          tfidfScore: result.tfidfScore,
          embeddingScore: result.embeddingScore,
          finalScore,
          matchedKeywords: result.matchedKeywords
        });
      }
    }

    // Sort by final score descending
    hybridResults.sort((a, b) => b.finalScore - a.finalScore);

    // Return top N results
    return hybridResults.slice(0, maxResults);
  }

  /**
   * Calculate combined score using configured weights
   */
  private calculateHybridScore(tfidfScore: number, embeddingScore: number): number {
    const tfidfWeight = this.settings.tfidfWeight;
    const embeddingWeight = this.settings.embeddingWeight;

    // Normalize weights to sum to 1
    const totalWeight = tfidfWeight + embeddingWeight;
    const normalizedTfidfWeight = tfidfWeight / totalWeight;
    const normalizedEmbeddingWeight = embeddingWeight / totalWeight;

    // Calculate weighted score
    return (tfidfScore * normalizedTfidfWeight) + (embeddingScore * normalizedEmbeddingWeight);
  }

  /**
   * Update settings
   */
  updateSettings(settings: SmartLinksSettings) {
    this.settings = settings;
  }
}
