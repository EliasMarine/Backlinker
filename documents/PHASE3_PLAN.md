# Phase 3: Neural Embeddings Implementation Plan

## Overview

Implement neural embeddings using `@xenova/transformers` with the `all-MiniLM-L6-v2` model for high-quality semantic similarity matching.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        main.ts                               │
│  - Initializes EmbeddingEngine                              │
│  - Manages model loading on startup                         │
│  - Coordinates embedding generation                         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    EmbeddingEngine                           │
│  src/engines/embedding-engine.ts                            │
│                                                             │
│  Responsibilities:                                          │
│  - Load/initialize transformer model                        │
│  - Generate embeddings for text                             │
│  - Calculate cosine similarity                              │
│  - Batch processing with progress                           │
│  - Error handling and fallback                              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   EmbeddingCache                             │
│  src/cache/embedding-cache.ts                               │
│                                                             │
│  Responsibilities:                                          │
│  - Store embeddings as Float32Array                         │
│  - Persist to .obsidian/plugins/smart-links/embeddings.bin  │
│  - Load cached embeddings on startup                        │
│  - Invalidate stale embeddings                              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   HybridScorer                               │
│  src/engines/hybrid-scorer.ts                               │
│                                                             │
│  Updates:                                                   │
│  - Accept EmbeddingEngine as optional dependency            │
│  - Use neural embeddings when available                     │
│  - Fall back to n-gram/context vectors otherwise            │
│  - Configurable weighting                                   │
└─────────────────────────────────────────────────────────────┘

## UI Components

┌─────────────────────────────────────────────────────────────┐
│              ModelDownloadModal                              │
│  src/ui/model-download-modal.ts                             │
│                                                             │
│  Features:                                                  │
│  - Progress bar for model download                          │
│  - Cancel button                                            │
│  - Error display                                            │
│  - Success confirmation                                     │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│              EmbeddingProgressModal                          │
│  src/ui/embedding-progress-modal.ts                         │
│                                                             │
│  Features:                                                  │
│  - Progress bar for batch embedding                         │
│  - ETA calculation                                          │
│  - Cancel button                                            │
│  - Notes processed counter                                  │
└─────────────────────────────────────────────────────────────┘
```

## Implementation Details

### 1. EmbeddingEngine (`src/engines/embedding-engine.ts`)

```typescript
interface EmbeddingEngineConfig {
  modelName: string;           // 'Xenova/all-MiniLM-L6-v2'
  maxSequenceLength: number;   // 256 tokens
  batchSize: number;           // 8 notes at a time
  cacheEnabled: boolean;
}

interface EmbeddingResult {
  notePath: string;
  embedding: Float32Array;     // 384 dimensions
  generatedAt: number;
}

class EmbeddingEngine {
  // Model management
  async loadModel(progressCallback?): Promise<void>
  isModelLoaded(): boolean
  unloadModel(): void

  // Embedding generation
  async generateEmbedding(text: string): Promise<Float32Array>
  async generateBatchEmbeddings(notes: NoteIndex[], progressCallback?): Promise<Map<string, Float32Array>>

  // Similarity
  cosineSimilarity(a: Float32Array, b: Float32Array): number
  findSimilarNotes(sourceEmbedding: Float32Array, allEmbeddings: Map<string, Float32Array>, topK: number): SimilarityResult[]
}
```

### 2. EmbeddingCache (`src/cache/embedding-cache.ts`)

```typescript
interface CachedEmbedding {
  notePath: string;
  noteHash: string;           // MD5 of content for invalidation
  embedding: Float32Array;
  modelVersion: string;
  generatedAt: number;
}

class EmbeddingCache {
  // Persistence
  async load(): Promise<void>
  async save(): Promise<void>

  // Cache operations
  get(notePath: string): Float32Array | null
  set(notePath: string, embedding: Float32Array, contentHash: string): void
  delete(notePath: string): void
  isValid(notePath: string, contentHash: string): boolean

  // Bulk operations
  getAll(): Map<string, Float32Array>
  clear(): void
  getStats(): { totalEmbeddings: number, cacheSizeMB: number }
}
```

### 3. Settings Updates

Add to SmartLinksSettings:
```typescript
// Neural embeddings
enableNeuralEmbeddings: boolean;      // default: false (opt-in)
neuralModelName: string;              // 'Xenova/all-MiniLM-L6-v2'
neuralWeight: number;                 // 0.0-1.0, weight in hybrid score
autoDownloadModel: boolean;           // prompt user first time
embeddingBatchSize: number;           // default: 8
```

### 4. Error Handling Strategy

```typescript
// Graceful degradation
try {
  await embeddingEngine.loadModel();
} catch (error) {
  // Fall back to n-gram/context vector semantic engine
  console.warn('[Smart Links] Neural embeddings unavailable, using fallback');
  new Notice('Neural embeddings unavailable. Using keyword-based matching.');
}

// Per-note error handling
try {
  embedding = await embeddingEngine.generateEmbedding(note.content);
} catch (error) {
  // Skip this note, continue with others
  console.warn(`[Smart Links] Failed to embed ${note.path}:`, error);
  failedNotes.push(note.path);
}
```

### 5. Performance Considerations

- **Lazy Loading**: Don't load model until user enables neural embeddings
- **Batch Processing**: Process 8 notes at a time to balance speed/memory
- **Caching**: Store embeddings to disk, only regenerate on content change
- **Background Processing**: Generate embeddings in background after vault analysis
- **Memory Management**: Unload model when not in use (optional setting)

## File Structure

```
src/
├── engines/
│   ├── embedding-engine.ts      # NEW: Neural embedding generation
│   ├── hybrid-scorer.ts         # UPDATE: Integrate neural embeddings
│   ├── tfidf-engine.ts          # No changes
│   ├── semantic-engine.ts       # Keep as fallback
│   ├── ngram-engine.ts          # Keep as fallback
│   └── context-vector-engine.ts # Keep as fallback
├── cache/
│   ├── cache-manager.ts         # No changes
│   └── embedding-cache.ts       # NEW: Embedding persistence
├── ui/
│   ├── suggestion-panel.ts      # No changes
│   ├── settings-tab.ts          # UPDATE: Neural embedding settings
│   └── embedding-progress-modal.ts # NEW: Progress UI
└── types/
    └── index.ts                 # UPDATE: New types
```

## Testing Checklist

- [ ] Model downloads successfully on first enable
- [ ] Progress modal shows during download
- [ ] Embeddings generate for all notes
- [ ] Embeddings persist to disk
- [ ] Cache loads on restart
- [ ] Stale embeddings regenerate on note change
- [ ] Hybrid scorer uses neural embeddings correctly
- [ ] Fallback works when model unavailable
- [ ] Memory usage is acceptable
- [ ] Can disable neural embeddings without issues

## Rollout Strategy

1. **Opt-in by default**: Neural embeddings disabled until user enables
2. **Prompt before download**: Ask user before downloading 23MB model
3. **Show progress**: Clear feedback during model download and embedding generation
4. **Graceful fallback**: Always fall back to existing semantic engine on errors
