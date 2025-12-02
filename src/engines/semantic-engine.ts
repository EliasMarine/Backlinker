/**
 * Semantic Engine - Main semantic similarity engine
 *
 * Combines N-gram phrase matching with context co-occurrence vectors
 * to provide reliable semantic understanding without neural embeddings
 */

import { NoteIndex, VaultCache } from '../types';
import { NGramEngine, NGramResult } from './ngram-engine';
import { ContextVectorEngine } from './context-vector-engine';

export interface SemanticSimilarityResult {
  note: NoteIndex;
  score: number;
  ngramScore: number;
  contextScore: number;
  matchedPhrases: string[];
}

export interface SemanticEngineStats {
  totalNotes: number;
  ngramStats: {
    avgBigramsPerNote: number;
    avgTrigramsPerNote: number;
  };
  contextStats: {
    totalWords: number;
    avgVectorSize: number;
  };
  ready: boolean;
}

/**
 * Semantic Engine combining multiple semantic similarity approaches
 */
export class SemanticEngine {
  private cache: VaultCache;
  private ngramEngine: NGramEngine;
  private contextEngine: ContextVectorEngine;
  private ngramResults: Map<string, NGramResult>;  // Cache of n-gram results per note
  private isReady: boolean = false;

  // Weights for combining scores
  private ngramWeight: number = 0.6;     // 60% weight for n-gram similarity
  private contextWeight: number = 0.4;   // 40% weight for context vector similarity

  constructor(cache: VaultCache) {
    this.cache = cache;
    this.ngramEngine = new NGramEngine(2);  // Minimum frequency of 2
    this.contextEngine = new ContextVectorEngine(5, 2);  // Window size 5, min occurrences 2
    this.ngramResults = new Map();
  }

  /**
   * Build semantic models from vault
   * This analyzes all notes and builds the semantic understanding
   */
  async buildModels(progressCallback?: (progress: number, message: string) => void): Promise<void> {
    console.log('[SemanticEngine] Building semantic models...');

    const notes = Array.from(this.cache.notes.values());
    const total = notes.length;

    if (total === 0) {
      console.warn('[SemanticEngine] No notes to process');
      this.isReady = false;
      return;
    }

    // Step 1: Extract n-grams from all notes (30% of work)
    if (progressCallback) {
      progressCallback(0, 'Extracting phrases from notes...');
    }

    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      const ngrams = this.ngramEngine.extractNGrams(note.cleanContent);
      this.ngramResults.set(note.path, ngrams);

      if (progressCallback && i % 10 === 0) {
        const progress = (i / total) * 30;
        progressCallback(progress, `Extracted phrases: ${i}/${total}`);
      }
    }

    if (progressCallback) {
      progressCallback(30, 'Building context vectors...');
    }

    // Step 2: Build context vectors from all documents (70% of work)
    const documents = notes.map((note, index) => {
      // Give more weight to recent notes and longer notes
      const recencyWeight = 1.0;  // Could add recency weighting later
      const lengthWeight = Math.min(note.cleanContent.length / 1000, 2.0);  // Cap at 2x
      const weight = recencyWeight * lengthWeight;

      if (progressCallback && index % 10 === 0) {
        const progress = 30 + ((index / total) * 70);
        progressCallback(progress, `Building context: ${index}/${total}`);
      }

      return {
        content: note.cleanContent,
        weight
      };
    });

    this.contextEngine.buildFromDocuments(documents);

    this.isReady = true;

    if (progressCallback) {
      progressCallback(100, 'Semantic models ready!');
    }

    console.log('[SemanticEngine] ✓ Models built successfully');
  }

  /**
   * Find semantically similar notes to a source note
   */
  findSimilarNotes(
    sourceNote: NoteIndex,
    threshold: number = 0.3,
    maxResults: number = 10
  ): SemanticSimilarityResult[] {
    if (!this.isReady) {
      console.warn('[SemanticEngine] Models not ready. Call buildModels() first.');
      return [];
    }

    const sourceNGrams = this.ngramResults.get(sourceNote.path);
    if (!sourceNGrams) {
      // Extract n-grams on-the-fly if not cached
      const ngrams = this.ngramEngine.extractNGrams(sourceNote.cleanContent);
      this.ngramResults.set(sourceNote.path, ngrams);
    }

    const results: SemanticSimilarityResult[] = [];

    // Compare against all other notes
    for (const [path, note] of this.cache.notes.entries()) {
      if (path === sourceNote.path) {
        continue;  // Skip self
      }

      const similarity = this.calculateSimilarity(sourceNote, note);

      if (similarity.score >= threshold) {
        results.push(similarity);
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, maxResults);
  }

  /**
   * Calculate semantic similarity between two notes
   */
  calculateSimilarity(note1: NoteIndex, note2: NoteIndex): SemanticSimilarityResult {
    // Get or compute n-grams
    let ngrams1 = this.ngramResults.get(note1.path);
    if (!ngrams1) {
      ngrams1 = this.ngramEngine.extractNGrams(note1.cleanContent);
      this.ngramResults.set(note1.path, ngrams1);
    }

    let ngrams2 = this.ngramResults.get(note2.path);
    if (!ngrams2) {
      ngrams2 = this.ngramEngine.extractNGrams(note2.cleanContent);
      this.ngramResults.set(note2.path, ngrams2);
    }

    // Calculate n-gram similarity (Jaccard similarity on phrases)
    const ngramScore = this.ngramEngine.calculateSimilarity(
      ngrams1.allNGrams,
      ngrams2.allNGrams
    );

    // Calculate context vector similarity
    const contextScore = this.contextEngine.calculateTextSimilarity(
      note1.cleanContent,
      note2.cleanContent
    );

    // Combine scores with weights
    const finalScore = (ngramScore * this.ngramWeight) + (contextScore * this.contextWeight);

    // Find matched phrases
    const matchedPhrases = ngrams1.allNGrams.filter(phrase =>
      ngrams2.allNGrams.includes(phrase)
    );

    return {
      note: note2,
      score: finalScore,
      ngramScore,
      contextScore,
      matchedPhrases: matchedPhrases.slice(0, 5)  // Top 5 matched phrases
    };
  }

  /**
   * Update semantic data for a single note (incremental update)
   */
  updateNote(note: NoteIndex): void {
    if (!this.isReady) {
      return;  // Can't update if models not built yet
    }

    // Update n-grams
    const ngrams = this.ngramEngine.extractNGrams(note.cleanContent);
    this.ngramResults.set(note.path, ngrams);

    // Note: Context vectors would need full rebuild
    // For incremental updates, we skip context vector updates
    // and rebuild them periodically in the background
  }

  /**
   * Remove note from semantic index
   */
  removeNote(notePath: string): void {
    this.ngramResults.delete(notePath);
  }

  /**
   * Get statistics about semantic models
   */
  getStatistics(): SemanticEngineStats {
    const ngramStats = {
      avgBigramsPerNote: 0,
      avgTrigramsPerNote: 0
    };

    if (this.ngramResults.size > 0) {
      let totalBigrams = 0;
      let totalTrigrams = 0;

      for (const ngrams of this.ngramResults.values()) {
        totalBigrams += ngrams.bigrams.size;
        totalTrigrams += ngrams.trigrams.size;
      }

      ngramStats.avgBigramsPerNote = totalBigrams / this.ngramResults.size;
      ngramStats.avgTrigramsPerNote = totalTrigrams / this.ngramResults.size;
    }

    const contextStats = this.contextEngine.getStatistics();

    return {
      totalNotes: this.cache.notes.size,
      ngramStats,
      contextStats: {
        totalWords: contextStats.totalWords,
        avgVectorSize: contextStats.avgVectorSize
      },
      ready: this.isReady
    };
  }

  /**
   * Set scoring weights for combining n-gram and context scores
   */
  setWeights(ngramWeight: number, contextWeight: number): void {
    // Normalize weights to sum to 1.0
    const total = ngramWeight + contextWeight;
    this.ngramWeight = ngramWeight / total;
    this.contextWeight = contextWeight / total;

    console.log('[SemanticEngine] Weights updated:', {
      ngram: this.ngramWeight,
      context: this.contextWeight
    });
  }

  /**
   * Check if semantic models are ready
   */
  isModelReady(): boolean {
    return this.isReady;
  }

  /**
   * Clear all semantic models
   */
  clear(): void {
    this.ngramResults.clear();
    this.contextEngine.clear();
    this.isReady = false;
    console.log('[SemanticEngine] Models cleared');
  }

  /**
   * Serialize semantic models for caching
   */
  serialize(): {
    ngramResults: Array<[string, any]>;
    contextVectors: string;
    weights: { ngram: number; context: number };
  } {
    const ngramData: Array<[string, any]> = [];

    for (const [path, ngrams] of this.ngramResults.entries()) {
      ngramData.push([
        path,
        {
          bigrams: Array.from(ngrams.bigrams.entries()),
          trigrams: Array.from(ngrams.trigrams.entries()),
          allNGrams: ngrams.allNGrams
        }
      ]);
    }

    return {
      ngramResults: ngramData,
      contextVectors: this.contextEngine.serialize(),
      weights: {
        ngram: this.ngramWeight,
        context: this.contextWeight
      }
    };
  }

  /**
   * Deserialize semantic models from cache
   */
  deserialize(data: {
    ngramResults: Array<[string, any]>;
    contextVectors: string;
    weights: { ngram: number; context: number };
  }): void {
    // Restore n-grams
    this.ngramResults.clear();

    for (const [path, ngramData] of data.ngramResults) {
      this.ngramResults.set(path, {
        bigrams: new Map(ngramData.bigrams),
        trigrams: new Map(ngramData.trigrams),
        allNGrams: ngramData.allNGrams
      });
    }

    // Restore context vectors
    this.contextEngine.deserialize(data.contextVectors);

    // Restore weights
    if (data.weights) {
      this.ngramWeight = data.weights.ngram;
      this.contextWeight = data.weights.context;
    }

    this.isReady = true;
    console.log('[SemanticEngine] Models restored from cache');
  }
}
