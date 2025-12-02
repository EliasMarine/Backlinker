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

import { NoteIndex } from '../types';

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
  modelName: 'Xenova/all-MiniLM-L6-v2',
  maxSequenceLength: 256,
  batchSize: 8
};

// Embedding dimension for all-MiniLM-L6-v2
const EMBEDDING_DIMENSION = 384;

// WASM CDN path for onnxruntime-web
const ONNX_WASM_CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.14.0/dist/';

/**
 * Configure ONNX Runtime environment for Obsidian/Electron
 * This MUST be called before any model loading
 */
async function configureOnnxRuntime(): Promise<void> {
  console.log('[EmbeddingEngine] Configuring ONNX Runtime for Obsidian...');

  try {
    // Import onnxruntime-web directly to configure it
    const ort = await import('onnxruntime-web');

    console.log('[EmbeddingEngine] onnxruntime-web imported successfully');

    // Configure WASM settings
    if (ort.env?.wasm) {
      ort.env.wasm.wasmPaths = ONNX_WASM_CDN;
      ort.env.wasm.numThreads = 1;  // Single thread for Electron compatibility
      ort.env.wasm.proxy = false;   // Disable web worker proxy

      console.log('[EmbeddingEngine] ONNX WASM configured:', {
        wasmPaths: ort.env.wasm.wasmPaths,
        numThreads: ort.env.wasm.numThreads,
        proxy: ort.env.wasm.proxy
      });
    } else {
      console.warn('[EmbeddingEngine] ort.env.wasm not found, trying alternative configuration');

      // Try setting on the env object directly
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ortAny = ort as any;
      if (ortAny.env) {
        ortAny.env.wasm = ortAny.env.wasm || {};
        ortAny.env.wasm.wasmPaths = ONNX_WASM_CDN;
        ortAny.env.wasm.numThreads = 1;
        ortAny.env.wasm.proxy = false;
        console.log('[EmbeddingEngine] Alternative WASM config applied');
      }
    }
  } catch (error) {
    console.warn('[EmbeddingEngine] Could not configure onnxruntime-web directly:', error);
    // Continue anyway - transformers.js might handle it
  }
}

/**
 * Configure Transformers.js environment
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function configureTransformersEnv(env: any): void {
  console.log('[EmbeddingEngine] Configuring Transformers.js environment...');

  // Use remote models only (no local file system)
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.useBrowserCache = true;

  // Disable file system usage
  if ('useFS' in env) {
    env.useFS = false;
  }

  // Try to configure ONNX backends if available
  if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.wasmPaths = ONNX_WASM_CDN;
    env.backends.onnx.wasm.numThreads = 1;
    env.backends.onnx.wasm.proxy = false;
    console.log('[EmbeddingEngine] env.backends.onnx.wasm configured');
  }

  console.log('[EmbeddingEngine] Transformers env configured:', {
    allowLocalModels: env.allowLocalModels,
    allowRemoteModels: env.allowRemoteModels,
    useBrowserCache: env.useBrowserCache,
  });
}

/**
 * Neural Embedding Engine
 * Generates semantic embeddings using transformer models
 */
export class EmbeddingEngine {
  private config: EmbeddingEngineConfig;
  private pipeline: Pipeline | null = null;
  private isLoading: boolean = false;
  private loadError: Error | null = null;
  private static onnxConfigured: boolean = false;

  constructor(config: Partial<EmbeddingEngineConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
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
        message: 'Configuring ONNX runtime...'
      });

      // IMPORTANT: Configure ONNX Runtime BEFORE importing transformers
      // This must happen only once
      if (!EmbeddingEngine.onnxConfigured) {
        await configureOnnxRuntime();
        EmbeddingEngine.onnxConfigured = true;
      }

      progressCallback?.({
        status: 'downloading',
        progress: 5,
        message: 'Importing Transformers.js...'
      });

      // Dynamic import of transformers
      console.log('[EmbeddingEngine] Importing @xenova/transformers...');
      const transformers = await import('@xenova/transformers');

      // Configure transformers environment
      configureTransformersEnv(transformers.env);

      console.log('[EmbeddingEngine] Loading model:', this.config.modelName);

      progressCallback?.({
        status: 'downloading',
        progress: 10,
        message: 'Downloading model files...'
      });

      // Wrap progress callback to translate library format to our format
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wrappedProgressCallback = (data: any) => {
        if (data.status === 'progress' && data.progress !== undefined) {
          // Map 0-100 to 10-90 range to leave room for setup/finalization
          const mappedProgress = 10 + (data.progress * 0.8);
          progressCallback?.({
            status: 'downloading',
            progress: Math.round(mappedProgress),
            loaded: data.loaded,
            total: data.total,
            file: data.file,
            message: `Downloading: ${data.file || 'model files'} (${Math.round(data.progress)}%)`
          });
        } else if (data.status === 'done') {
          progressCallback?.({
            status: 'loading',
            progress: 95,
            message: 'Loading model into memory...'
          });
        }
      };

      // Load the feature extraction pipeline
      console.log('[EmbeddingEngine] Creating pipeline...');

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

      console.log('[EmbeddingEngine] Model loaded successfully!');
      progressCallback?.({ status: 'ready', progress: 100, message: 'Model ready!' });

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
   * @returns 384-dimensional Float32Array
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
      if (embedding.length !== EMBEDDING_DIMENSION) {
        console.warn(
          `[EmbeddingEngine] Unexpected embedding dimension: ${embedding.length}, expected ${EMBEDDING_DIMENSION}`
        );
      }

      return embedding;

    } catch (error) {
      console.error('[EmbeddingEngine] Failed to generate embedding:', error);
      throw error;
    }
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

    // Process in batches
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

        } catch (error) {
          console.error(`[EmbeddingEngine] Failed to embed ${note.path}:`, error);
          // Continue with other notes
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
   * Get the embedding dimension (384 for all-MiniLM-L6-v2)
   */
  getEmbeddingDimension(): number {
    return EMBEDDING_DIMENSION;
  }

  /**
   * Get current configuration
   */
  getConfig(): EmbeddingEngineConfig {
    return { ...this.config };
  }

  /**
   * Update configuration (requires model reload to take effect for modelName)
   */
  updateConfig(config: Partial<EmbeddingEngineConfig>): void {
    const oldModelName = this.config.modelName;
    this.config = { ...this.config, ...config };

    // If model name changed, unload the old model
    if (config.modelName && config.modelName !== oldModelName && this.pipeline) {
      console.log('[EmbeddingEngine] Model name changed, unloading old model');
      this.unloadModel();
    }
  }
}
