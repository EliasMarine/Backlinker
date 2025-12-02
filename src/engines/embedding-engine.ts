/**
 * Neural Embedding Engine for Smart Links
 *
 * Uses @xenova/transformers with all-MiniLM-L6-v2 model
 * for high-quality semantic similarity matching.
 *
 * Features:
 * - Lazy model loading with progress callbacks
 * - Batch processing for efficiency
 * - Cosine similarity calculation
 * - Graceful error handling and fallback
 */

import { NoteIndex, getModelConfig, getDefaultModelConfig, EmbeddingModelConfig } from '../types';

// Type definitions for @xenova/transformers pipeline
interface Pipeline {
  (texts: string | string[], options?: { pooling: string; normalize: boolean }): Promise<{
    data: Float32Array;
  }>;
}

export interface EmbeddingEngineConfig {
  modelName: string;
  maxSequenceLength: number;
  batchSize: number;
}

/**
 * Get the embedding dimension for a model
 * Falls back to 384 if model not found in registry
 */
export function getModelDimension(modelName: string): number {
  const config = getModelConfig(modelName);
  return config?.dimension ?? 384;
}

export interface EmbeddingResult {
  notePath: string;
  embedding: Float32Array;
  generatedAt: number;
}

export interface SimilarityResult {
  notePath: string;
  similarity: number;
}

export interface ProgressInfo {
  status: 'downloading' | 'loading' | 'ready' | 'error';
  progress?: number;  // 0-100
  loaded?: number;    // bytes loaded
  total?: number;     // total bytes
  file?: string;      // current file being downloaded
  message?: string;   // human-readable status
}

export type ProgressCallback = (info: ProgressInfo) => void;

export interface BatchProgressInfo {
  current: number;
  total: number;
  notePath: string;
  eta?: number;  // estimated seconds remaining
}

export type BatchProgressCallback = (info: BatchProgressInfo) => void;

const DEFAULT_CONFIG: EmbeddingEngineConfig = {
  modelName: getDefaultModelConfig().name,
  maxSequenceLength: 256,
  batchSize: 8
};

// Note: WASM CDN paths are configured at build time via esbuild plugin (esbuild.config.mjs)
// The bundled onnxruntime-web version is 1.14.0 (matching @xenova/transformers@2.17.2)

/**
 * Neural Embedding Engine
 * Generates semantic embeddings using transformer models
 */
export class EmbeddingEngine {
  private config: EmbeddingEngineConfig;
  private pipeline: Pipeline | null = null;
  private isLoading: boolean = false;
  private loadError: Error | null = null;
  private currentModelConfig: EmbeddingModelConfig | null = null;

  constructor(config: Partial<EmbeddingEngineConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.currentModelConfig = getModelConfig(this.config.modelName) || getDefaultModelConfig();
  }

  /**
   * Get the current model configuration
   */
  getModelConfig(): EmbeddingModelConfig {
    return this.currentModelConfig || getDefaultModelConfig();
  }

  /**
   * Load the transformer model
   * Downloads model on first use (~23MB)
   */
  async loadModel(progressCallback?: ProgressCallback): Promise<void> {
    if (this.pipeline) {
      console.log('[EmbeddingEngine] Model already loaded');
      progressCallback?.({ status: 'ready', message: 'Model already loaded' });
      return;
    }

    if (this.isLoading) {
      console.log('[EmbeddingEngine] Model is already loading');
      return;
    }

    this.isLoading = true;
    this.loadError = null;

    try {
      progressCallback?.({
        status: 'downloading',
        progress: 0,
        message: 'Initializing neural processing library...'
      });

      // Import transformers.js
      // ONNX runtime WASM paths are configured at build time via esbuild plugin
      console.log('[EmbeddingEngine] Importing @xenova/transformers...');
      const transformers = await import('@xenova/transformers');

      progressCallback?.({
        status: 'downloading',
        progress: 5,
        message: 'Configuring WASM runtime...'
      });

      // Configure transformers environment
      const env = transformers.env;
      env.allowLocalModels = false;
      env.allowRemoteModels = true;
      env.useBrowserCache = true;

      // CRITICAL: Set WASM paths AFTER importing transformers
      // Transformers' init_env() detects RUNNING_LOCALLY=true in Electron and
      // overwrites wasmPaths with a local path like "/dist/". We must set the
      // CDN path AFTER transformers initializes to override its local path.
      // The version MUST match what @xenova/transformers expects (1.14.0 for v2.17.2)
      const WASM_CDN_PATH = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.14.0/dist/';
      if (env.backends?.onnx?.wasm) {
        env.backends.onnx.wasm.wasmPaths = WASM_CDN_PATH;
        env.backends.onnx.wasm.numThreads = 1;
        env.backends.onnx.wasm.proxy = false;
        console.log('[EmbeddingEngine] WASM paths set to CDN:', WASM_CDN_PATH);
      } else {
        console.warn('[EmbeddingEngine] Could not set WASM paths - onnx backend not found');
      }

      console.log('[EmbeddingEngine] Transformers env configured:', {
        allowLocalModels: env.allowLocalModels,
        useBrowserCache: env.useBrowserCache,
        wasmPaths: env.backends?.onnx?.wasm?.wasmPaths,
      });

      console.log('[EmbeddingEngine] Loading model:', this.config.modelName);

      progressCallback?.({
        status: 'downloading',
        progress: 10,
        message: 'Connecting to model repository...'
      });

      // Track which files we've seen to show better messages
      let lastFile = '';
      let filesDownloaded = 0;

      // Wrap progress callback to translate library format to our format
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wrappedProgressCallback = (data: any) => {
        if (data.status === 'initiate') {
          // New file starting
          const fileName = data.file || 'model component';
          progressCallback?.({
            status: 'downloading',
            progress: 10 + (filesDownloaded * 5),
            message: `Fetching ${fileName}...`
          });
        } else if (data.status === 'progress' && data.progress !== undefined) {
          // Download progress for current file
          if (data.file && data.file !== lastFile) {
            lastFile = data.file;
            filesDownloaded++;
          }

          // Map progress: 10-85% for downloads
          const baseProgress = 10 + (filesDownloaded * 5);
          const fileProgress = data.progress * 0.15; // Each file gets ~15% of total
          const mappedProgress = Math.min(85, baseProgress + fileProgress);

          const fileName = data.file || 'model';
          let message = `Downloading ${fileName}`;

          if (data.loaded && data.total) {
            const loadedMB = (data.loaded / (1024 * 1024)).toFixed(1);
            const totalMB = (data.total / (1024 * 1024)).toFixed(1);
            message = `Downloading ${fileName} (${loadedMB}/${totalMB} MB)`;
          } else {
            message = `Downloading ${fileName} (${Math.round(data.progress)}%)`;
          }

          progressCallback?.({
            status: 'downloading',
            progress: Math.round(mappedProgress),
            loaded: data.loaded,
            total: data.total,
            file: data.file,
            message
          });
        } else if (data.status === 'done') {
          // File complete
          filesDownloaded++;
          progressCallback?.({
            status: 'loading',
            progress: 88,
            message: 'Download complete, initializing ONNX runtime...'
          });
        }
      };

      // Load the feature extraction pipeline
      console.log('[EmbeddingEngine] Creating pipeline...');

      progressCallback?.({
        status: 'loading',
        progress: 90,
        message: 'Creating inference pipeline...'
      });

      // Use type assertion to access pipeline function
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pipelineFn = (transformers as any).pipeline;

      this.pipeline = await pipelineFn(
        'feature-extraction',
        this.config.modelName,
        {
          progress_callback: wrappedProgressCallback,
          quantized: true,  // Use quantized model for faster loading
        }
      );

      progressCallback?.({
        status: 'loading',
        progress: 98,
        message: 'Warming up neural network...'
      });

      // Yield to allow UI to update before final message
      await new Promise(resolve => setTimeout(resolve, 100));

      console.log('[EmbeddingEngine] Model loaded successfully!');
      progressCallback?.({ status: 'ready', progress: 100, message: 'Neural model ready!' });

    } catch (error) {
      this.loadError = error instanceof Error ? error : new Error(String(error));
      console.error('[EmbeddingEngine] Failed to load model:', error);
      progressCallback?.({
        status: 'error',
        message: `Failed to load model: ${this.loadError.message}`
      });
      throw this.loadError;
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Check if the model is loaded and ready
   */
  isModelLoaded(): boolean {
    return this.pipeline !== null;
  }

  /**
   * Check if the model is currently loading
   */
  isModelLoading(): boolean {
    return this.isLoading;
  }

  /**
   * Get the last load error, if any
   */
  getLoadError(): Error | null {
    return this.loadError;
  }

  /**
   * Unload the model to free memory
   */
  unloadModel(): void {
    if (this.pipeline) {
      console.log('[EmbeddingEngine] Unloading model');
      this.pipeline = null;
    }
  }

  /**
   * Generate embedding for a single text
   * @param text - Text to embed (will be truncated if too long)
   * @returns Float32Array with dimension based on current model
   */
  async generateEmbedding(text: string): Promise<Float32Array> {
    if (!this.pipeline) {
      throw new Error('Model not loaded. Call loadModel() first.');
    }

    // Truncate text if too long (rough approximation: 4 chars per token)
    const maxChars = this.config.maxSequenceLength * 4;
    const truncatedText = text.length > maxChars
      ? text.slice(0, maxChars)
      : text;

    try {
      // Generate embedding with mean pooling and normalization
      const output = await this.pipeline(truncatedText, {
        pooling: 'mean',
        normalize: true
      });

      // Extract the embedding vector
      const embedding = new Float32Array(output.data);

      // Validate dimension
      const expectedDimension = this.getEmbeddingDimension();
      if (embedding.length !== expectedDimension) {
        console.warn(
          `[EmbeddingEngine] Unexpected embedding dimension: ${embedding.length}, expected ${expectedDimension}`
        );
      }

      return embedding;

    } catch (error) {
      console.error('[EmbeddingEngine] Failed to generate embedding:', error);
      throw error;
    }
  }

  /**
   * Yield to the event loop to keep UI responsive
   * Uses setTimeout(0) to allow pending UI updates and user interactions
   */
  private yieldToEventLoop(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
  }

  /**
   * Generate embeddings for multiple notes in batches
   * @param notes - Array of NoteIndex objects to embed
   * @param progressCallback - Optional callback for progress updates
   * @returns Map of note paths to embeddings
   */
  async generateBatchEmbeddings(
    notes: NoteIndex[],
    progressCallback?: BatchProgressCallback
  ): Promise<Map<string, Float32Array>> {
    if (!this.pipeline) {
      throw new Error('Model not loaded. Call loadModel() first.');
    }

    const results = new Map<string, Float32Array>();
    const totalNotes = notes.length;
    const startTime = Date.now();
    let processedCount = 0;

    console.log(`[EmbeddingEngine] Starting batch embedding for ${totalNotes} notes`);

    // Process in batches with UI yielding
    for (let i = 0; i < totalNotes; i += this.config.batchSize) {
      const batch = notes.slice(i, i + this.config.batchSize);

      // Process each note in the batch
      for (const note of batch) {
        try {
          const text = note.cleanContent || note.content;
          if (!text || text.trim().length === 0) {
            console.warn(`[EmbeddingEngine] Skipping empty note: ${note.path}`);
            continue;
          }

          const embedding = await this.generateEmbedding(text);
          results.set(note.path, embedding);
          processedCount++;

          // Calculate ETA
          const elapsed = (Date.now() - startTime) / 1000;
          const rate = processedCount / elapsed;
          const remaining = totalNotes - processedCount;
          const eta = rate > 0 ? remaining / rate : undefined;

          progressCallback?.({
            current: processedCount,
            total: totalNotes,
            notePath: note.path,
            eta: eta ? Math.round(eta) : undefined
          });

          // Yield to event loop after each note to keep UI responsive
          // This is critical because ONNX inference is CPU-bound and blocks the main thread
          await this.yieldToEventLoop();

        } catch (error) {
          // Check if this is a cancellation - if so, stop processing immediately
          if (error instanceof Error && error.message === 'Cancelled by user') {
            console.log('[EmbeddingEngine] Batch embedding cancelled by user');
            throw error; // Re-throw to stop the batch
          }
          console.error(`[EmbeddingEngine] Failed to embed ${note.path}:`, error);
          // Continue with other notes for non-cancellation errors
        }
      }
    }

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(
      `[EmbeddingEngine] Batch embedding complete: ${results.size}/${totalNotes} notes in ${totalTime}s`
    );

    return results;
  }

  /**
   * Calculate cosine similarity between two embeddings
   * Both embeddings should already be normalized
   * @returns Similarity score between -1 and 1 (typically 0-1 for text)
   */
  cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) {
      throw new Error(
        `Embedding dimension mismatch: ${a.length} vs ${b.length}`
      );
    }

    // For normalized vectors, cosine similarity is just the dot product
    let dotProduct = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
    }

    return dotProduct;
  }

  /**
   * Find the most similar notes to a source embedding
   * @param sourceEmbedding - Embedding of the source note
   * @param allEmbeddings - Map of all note embeddings
   * @param topK - Number of results to return
   * @param excludePaths - Optional set of paths to exclude (e.g., source note)
   * @returns Array of similarity results, sorted by similarity (highest first)
   */
  findSimilarNotes(
    sourceEmbedding: Float32Array,
    allEmbeddings: Map<string, Float32Array>,
    topK: number,
    excludePaths?: Set<string>
  ): SimilarityResult[] {
    const results: SimilarityResult[] = [];

    for (const [notePath, embedding] of allEmbeddings) {
      // Skip excluded paths
      if (excludePaths?.has(notePath)) {
        continue;
      }

      const similarity = this.cosineSimilarity(sourceEmbedding, embedding);
      results.push({ notePath, similarity });
    }

    // Sort by similarity (descending) and take top K
    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, topK);
  }

  /**
   * Get the embedding dimension for the current model
   */
  getEmbeddingDimension(): number {
    return this.currentModelConfig?.dimension ?? 384;
  }

  /**
   * Get current configuration
   */
  getConfig(): EmbeddingEngineConfig {
    return { ...this.config };
  }

  /**
   * Update configuration (requires model reload to take effect for modelName)
   * @returns true if model changed and reload is needed
   */
  updateConfig(config: Partial<EmbeddingEngineConfig>): boolean {
    const oldModelName = this.config.modelName;
    this.config = { ...this.config, ...config };

    // If model name changed, update model config and unload old model
    if (config.modelName && config.modelName !== oldModelName) {
      console.log(`[EmbeddingEngine] Model changed from ${oldModelName} to ${config.modelName}`);
      this.currentModelConfig = getModelConfig(config.modelName) || getDefaultModelConfig();

      if (this.pipeline) {
        console.log('[EmbeddingEngine] Unloading old model');
        this.unloadModel();
      }
      return true;
    }
    return false;
  }

  /**
   * Get the current model name
   */
  getModelName(): string {
    return this.config.modelName;
  }
}
