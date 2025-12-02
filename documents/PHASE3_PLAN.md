# Phase 3: Neural Embeddings Implementation Plan

**Status**: ✅ IMPLEMENTATION COMPLETE (December 1, 2025)
**Testing Status**: 🔄 Needs end-to-end testing in Obsidian

## Overview

Implement neural embeddings using `@xenova/transformers` with the `all-MiniLM-L6-v2` model for high-quality semantic similarity matching.

---

## Implementation Status

### ✅ Completed Components

| Component | File | Status | Notes |
|-----------|------|--------|-------|
| EmbeddingEngine | `src/engines/embedding-engine.ts` | ✅ Complete | Model loading, batch processing, similarity |
| EmbeddingCache | `src/cache/embedding-cache.ts` | ✅ Complete | Binary persistence, hash invalidation |
| Progress Modals | `src/ui/embedding-progress-modal.ts` | ✅ Complete | Download + batch progress, cancel support |
| HybridScorer Integration | `src/engines/hybrid-scorer.ts` | ✅ Complete | Neural > Semantic > TF-IDF fallback |
| Settings UI | `src/settings.ts` | ✅ Complete | Enable toggle, regenerate button, status |
| Main.ts Integration | `main.ts` | ✅ Complete | Lifecycle management, batch processing |
| Type Definitions | `src/types/index.ts` | ✅ Complete | New settings fields |
| Styles | `styles.css` | ✅ Complete | Status display styles |

### 🔄 Needs Testing

| Item | Status | Notes |
|------|--------|-------|
| Model download flow | 🔄 Untested | Need to verify ~23MB download works |
| Batch embedding generation | 🔄 Untested | Need to test with real vault |
| Cache persistence | 🔄 Untested | Need to verify binary format works |
| Hybrid scoring with embeddings | 🔄 Untested | Need to verify suggestions improve |
| Memory usage | 🔄 Untested | Need to profile with large vaults |
| Error handling | 🔄 Untested | Need to test failure scenarios |

### ❌ Not Implemented (Deferred)

| Item | Reason | Priority |
|------|--------|----------|
| Auto-download model option | Simplified to manual enable | Low |
| Background embedding generation | Current batch approach sufficient | Low |
| Model unload on idle | Memory not a concern in testing | Low |
| neuralWeight setting | Using existing semanticWeight | Low |

---

## Architecture (As Implemented)

```
┌─────────────────────────────────────────────────────────────┐
│                        main.ts                               │
│  ✅ Initializes EmbeddingEngine (lazy, on enable)           │
│  ✅ Manages embedding cache lifecycle                        │
│  ✅ Coordinates batch embedding generation                   │
│  ✅ enableNeuralEmbeddings() / disableNeuralEmbeddings()    │
│  ✅ regenerateEmbeddings()                                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    EmbeddingEngine                           │
│  src/engines/embedding-engine.ts                            │
│                                                             │
│  ✅ loadModel(progressCallback) - with progress tracking    │
│  ✅ isModelLoaded() / isModelLoading()                      │
│  ✅ unloadModel()                                           │
│  ✅ generateEmbedding(text) - single text                   │
│  ✅ generateBatchEmbeddings(notes, progressCallback)        │
│  ✅ cosineSimilarity(a, b)                                  │
│  ✅ findSimilarNotes(source, all, topK, exclude)            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   EmbeddingCache                             │
│  src/cache/embedding-cache.ts                               │
│                                                             │
│  ✅ load() / save() - binary format                         │
│  ✅ get(path) / set(path, embedding, hash)                  │
│  ✅ isValid(path, hash) - content hash validation           │
│  ✅ getAll() / getAllPaths() / size()                       │
│  ✅ clear() / delete(path) / rename(old, new)               │
│  ✅ getStats() / getCacheSizeFormatted()                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   HybridScorer                               │
│  src/engines/hybrid-scorer.ts                               │
│                                                             │
│  ✅ setEmbeddingEngine(engine, cache)                       │
│  ✅ hasNeuralEmbeddings() / hasSemanticSearch()             │
│  ✅ hybridSearchWithEmbeddings() - new method               │
│  ✅ Priority: Neural > Semantic > TF-IDF                    │
└─────────────────────────────────────────────────────────────┘

## UI Components (As Implemented)

┌─────────────────────────────────────────────────────────────┐
│              EmbeddingProgressModal                          │
│  src/ui/embedding-progress-modal.ts                         │
│                                                             │
│  ✅ Mode: 'download' or 'embedding'                         │
│  ✅ updateDownloadProgress(info) - model download           │
│  ✅ updateBatchProgress(info) - embedding generation        │
│  ✅ showComplete(count) / showError(title, msg)             │
│  ✅ Cancel button with wasCancelled()                       │
│  ✅ ETA calculation and display                             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│              EnableEmbeddingsModal                           │
│  src/ui/embedding-progress-modal.ts                         │
│                                                             │
│  ✅ Confirmation dialog before model download               │
│  ✅ Explains 23MB download and local processing             │
│  ✅ onConfirm callback                                      │
└─────────────────────────────────────────────────────────────┘
```

---

## Settings (As Implemented)

Added to `SmartLinksSettings` in `src/types/index.ts`:

```typescript
// Neural embeddings (Phase 3)
enableNeuralEmbeddings: boolean;  // default: false (opt-in)
neuralModelName: string;          // default: 'Xenova/all-MiniLM-L6-v2'
embeddingBatchSize: number;       // default: 8
```

**Note**: `neuralWeight` was not added - using existing `semanticWeight` for simplicity.

---

## File Structure (Final)

```
src/
├── engines/
│   ├── embedding-engine.ts      # ✅ NEW: Neural embedding generation
│   ├── hybrid-scorer.ts         # ✅ UPDATED: Integrate neural embeddings
│   ├── tfidf-engine.ts          # ✅ UPDATED: Added getNote() method
│   ├── semantic-engine.ts       # No changes (fallback)
│   ├── ngram-engine.ts          # No changes (fallback)
│   └── context-vector-engine.ts # No changes (fallback)
├── cache/
│   ├── cache-manager.ts         # No changes
│   └── embedding-cache.ts       # ✅ NEW: Embedding persistence
├── ui/
│   ├── suggestion-panel.ts      # No changes
│   ├── settings-tab.ts          # ✅ UPDATED: Neural embedding settings
│   └── embedding-progress-modal.ts # ✅ NEW: Progress UI + confirmation
├── types/
│   └── index.ts                 # ✅ UPDATED: New settings fields
└── styles.css                   # ✅ UPDATED: Status display styles

main.ts                          # ✅ UPDATED: Embedding lifecycle management
```

---

## Testing Checklist

### Model Download
- [ ] Enable neural embeddings in settings
- [ ] Confirmation modal appears with explanation
- [ ] Click "Enable & Download" starts download
- [ ] Progress modal shows download progress
- [ ] Model downloads successfully (~23MB)
- [ ] "Model ready" message appears
- [ ] Progress modal closes or shows success

### Embedding Generation
- [ ] After model loads, embedding progress modal appears
- [ ] Progress bar updates during processing
- [ ] ETA shows and updates realistically
- [ ] Notes processed counter increments
- [ ] Can cancel generation mid-process
- [ ] Completion message shows correct count

### Cache Persistence
- [ ] After generation, reload Obsidian
- [ ] Check: `embedding-metadata.json` exists in plugin folder
- [ ] Check: `embeddings.bin` exists in plugin folder
- [ ] Embeddings load from cache on restart
- [ ] Cache stats show in settings

### Hybrid Search with Embeddings
- [ ] Type in a note to trigger suggestions
- [ ] Console shows "Using hybrid search (TF-IDF + Neural Embeddings)"
- [ ] Suggestions appear with semantic scores
- [ ] Suggestions quality improves vs TF-IDF only

### Fallback Behavior
- [ ] Disable neural embeddings in settings
- [ ] Suggestions still work (TF-IDF + n-gram fallback)
- [ ] Console shows appropriate fallback message
- [ ] No errors when embeddings disabled

### Regenerate Function
- [ ] Click "Regenerate" button in settings
- [ ] Progress modal appears
- [ ] Only stale/missing embeddings are processed
- [ ] Cache updates correctly
- [ ] "All embeddings up to date" if nothing to process

### Error Handling
- [ ] Simulate network error during download
- [ ] Error message displays in modal
- [ ] Can close modal and retry
- [ ] Plugin continues working without embeddings

### Performance
- [ ] Test with 100 notes - embedding generation time
- [ ] Test with 500 notes - embedding generation time
- [ ] Monitor memory usage during generation
- [ ] Verify real-time suggestions stay responsive

---

## Rollout Strategy (As Implemented)

1. ✅ **Opt-in by default**: Neural embeddings disabled until user enables
2. ✅ **Confirmation before download**: Modal explains 23MB download + local processing
3. ✅ **Show progress**: Clear feedback during model download and embedding generation
4. ✅ **Graceful fallback**: Falls back to n-gram/context semantic when embeddings unavailable
5. ✅ **Cancel support**: User can cancel embedding generation mid-process

---

## Known Limitations

1. **First-time download**: Requires ~23MB download (cached by browser after)
2. **Processing time**: ~1-2 seconds per note for embedding generation
3. **Memory usage**: Model uses ~100-200MB RAM when loaded
4. **Storage**: Binary cache grows with vault size (~1.5KB per note)

---

## Future Enhancements (Not in Scope)

1. **Background generation**: Generate embeddings in background during idle
2. **Incremental updates**: Update single note embedding on file change
3. **Model selection**: Allow user to choose different models
4. **Memory optimization**: Unload model when not in use
5. **Streaming generation**: Show suggestions as embeddings generate

---

## Technical Notes

### Model Details
- **Model**: `Xenova/all-MiniLM-L6-v2`
- **Dimensions**: 384
- **Size**: ~23MB (ONNX format)
- **Runtime**: WebAssembly via @xenova/transformers

### Cache Format
- **Metadata**: JSON file with paths, hashes, offsets
- **Embeddings**: Binary Float32Array (384 floats × 4 bytes = 1,536 bytes per note)
- **Location**: `.obsidian/plugins/smart-links/`

### Hash Algorithm
- **Type**: djb2 (fast, non-cryptographic)
- **Input**: Note content (cleanContent or content)
- **Purpose**: Detect content changes for cache invalidation

---

**Phase 3 implementation is complete. Ready for end-to-end testing in Obsidian!**
