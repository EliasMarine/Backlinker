/**
 * Embedding Engine for Smart Links
 *
 * Generates semantic embeddings using transformers.js
 * Optional feature that provides deeper semantic understanding beyond TF-IDF
 */

import { pipeline, Pipeline, FeatureExtractionPipeline } from '@xenova/transformers';
import { NoteIndex, VaultCache, ProgressCallback } from '../types';

export interface EmbeddingResult {
  note: NoteIndex;
  score: number; // cosine similarity 0-1
}

export interface EmbeddingEngineStats {
  totalEmbeddings: number;
  avgGenerationTime: number; // ms per embedding
  modelLoaded: boolean;
  modelName: string;
}

/**
 * Embedding Engine
 * Handles semantic embedding generation and similarity search
 */
export class EmbeddingEngine {
  private cache: VaultCache;
  private model: FeatureExtractionPipeline | null = null;
  private modelName: string = 'Xenova/all-MiniLM-L6-v2';
  private isLoading: boolean = false;
  private batchSize: number = 8;

  // Performance tracking
  private totalGenerationTime: number = 0;
  private totalGenerations: number = 0;

  constructor(cache: VaultCache) {
    this.cache = cache;
  }

  /**
   * Load the embedding model
   * Downloads model on first use (cached locally thereafter)
   */
  async loadModel(): Promise<void> {
    if (this.model) {
      return; // Already loaded
    }

    if (this.isLoading) {
      // Wait for current loading to complete
      while (this.isLoading) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return;
    }

    this.isLoading = true;

    try {
      console.log('[Smart Links] Loading embedding model:', this.modelName);
      const startTime = Date.now();

      this.model = await pipeline('feature-extraction', this.modelName);

      const duration = Date.now() - startTime;
      console.log(`[Smart Links] Model loaded in ${(duration / 1000).toFixed(1)}s`);
    } catch (error) {
      console.error('[Smart Links] Failed to load embedding model:', error);
      throw new Error('Failed to load embedding model. Embeddings will be disabled.');
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Generate embedding for a single text
   */
  async generateEmbedding(text: string): Promise<Float32Array> {
    if (!this.model) {
      await this.loadModel();
    }

    if (!this.model) {
      throw new Error('Model not loaded');
    }

    const startTime = Date.now();

    try {
      // Generate embedding using transformers.js
      const output = await this.model(text, {
        pooling: 'mean',
        normalize: true
      });

      // Convert to Float32Array
      const embedding = Float32Array.from(output.data as ArrayLike<number>);

      // Track performance
      this.totalGenerationTime += Date.now() - startTime;
      this.totalGenerations++;

      return embedding;
    } catch (error) {
      console.error('[Smart Links] Failed to generate embedding:', error);
      throw error;
    }
  }

  /**
   * Generate embeddings for multiple notes in batches
   */
  async generateEmbeddingsForNotes(
    notes: NoteIndex[],
    progressCallback?: ProgressCallback
  ): Promise<void> {
    if (!this.model) {
      await this.loadModel();
    }

    const total = notes.length;
    let processed = 0;

    // Process in batches
    for (let i = 0; i < notes.length; i += this.batchSize) {
      const batch = notes.slice(i, i + this.batchSize);

      // Generate embeddings for batch
      await Promise.all(
        batch.map(async (note) => {
          try {
            // Use clean content for embedding
            const embedding = await this.generateEmbedding(note.cleanContent);
            note.embedding = embedding;
            note.embeddingVersion = this.modelName;
          } catch (error) {
            console.error(`[Smart Links] Failed to generate embedding for ${note.path}:`, error);
          }
        })
      );

      processed += batch.length;

      if (progressCallback) {
        progressCallback((processed / total) * 100, `Generated embeddings: ${processed}/${total}`);
      }

      // Yield to UI thread
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  /**
   * Calculate cosine similarity between two embeddings
   */
  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) {
      throw new Error('Embeddings must have same dimension');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (normA * normB);
  }

  /**
   * Find similar notes using embeddings
   */
  findSimilarNotes(
    sourceNote: NoteIndex,
    threshold: number = 0.6,
    maxResults: number = 10
  ): EmbeddingResult[] {
    if (!sourceNote.embedding) {
      throw new Error('Source note does not have an embedding');
    }

    const results: EmbeddingResult[] = [];

    // Compare against all other notes with embeddings
    for (const [path, note] of this.cache.notes.entries()) {
      // Skip self
      if (path === sourceNote.path) {
        continue;
      }

      // Skip notes without embeddings
      if (!note.embedding) {
        continue;
      }

      // Calculate similarity
      const score = this.cosineSimilarity(sourceNote.embedding, note.embedding);

      // Filter by threshold
      if (score >= threshold) {
        results.push({ note, score });
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    // Return top N results
    return results.slice(0, maxResults);
  }

  /**
   * Get statistics about embeddings
   */
  getStatistics(): EmbeddingEngineStats {
    let totalEmbeddings = 0;

    for (const note of this.cache.notes.values()) {
      if (note.embedding) {
        totalEmbeddings++;
      }
    }

    return {
      totalEmbeddings,
      avgGenerationTime: this.totalGenerations > 0
        ? this.totalGenerationTime / this.totalGenerations
        : 0,
      modelLoaded: this.model !== null,
      modelName: this.modelName
    };
  }

  /**
   * Unload model to free memory
   */
  async unloadModel(): Promise<void> {
    this.model = null;
    console.log('[Smart Links] Embedding model unloaded');
  }
}
