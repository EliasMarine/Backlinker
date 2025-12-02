# Phase 3: Neural Embeddings Implementation Plan

**Status**: ✅ TESTED & WORKING + MODEL SELECTION (December 2, 2025)
**Testing Status**: ✅ Core functionality tested, model selection added
**Git Branch**: `fix/neural-embeddings-wasm-paths`

## Overview

Implement neural embeddings using `@xenova/transformers` with configurable models for high-quality semantic similarity matching. Users can choose between 4 different models based on their speed/quality preferences.

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

### ✅ Tested & Fixed

| Item | Status | Notes |
|------|--------|-------|
| Model download flow | ✅ Working | Fixed WASM CDN paths for Electron |
| Batch embedding generation | ✅ Working | 121 notes in 20.8s, UI responsive |
| Cache persistence | ✅ Fixed | Fixed "file already exists" errors |
| Progress feedback | ✅ Enhanced | Detailed status messages, note names |

### ✅ Model Selection Feature (NEW)

| Item | Status | Notes |
|------|--------|-------|
| Model registry | ✅ Complete | 4 models defined with metadata |
| Settings dropdown | ✅ Complete | User can select from available models |
| Model info display | ✅ Complete | Shows description, speed, quality, dimensions |
| Dynamic dimensions | ✅ Complete | Engine and cache support 384 or 768 dim |
| Cache invalidation | ✅ Complete | Auto-clears on model change |
| Model switching | ✅ Complete | Auto-regenerates embeddings |

**Available Models:**
| Model | Dimensions | Size | Speed | Quality |
|-------|------------|------|-------|---------|
| MiniLM-L6 (default) | 384 | ~23MB | Fast | Good |
| MiniLM-L12 | 384 | ~33MB | Medium | Better |
| BGE Small | 384 | ~33MB | Medium | Better |
| BGE Base | 768 | ~110MB | Slow | Best |

### 🔄 Still Needs Testing

| Item | Status | Notes |
|------|--------|-------|
| Hybrid scoring with embeddings | 🔄 Pending | Need to verify suggestions improve |
| Cache load on restart | 🔄 Pending | Need to verify embeddings persist |
| Memory usage | 🔄 Pending | Need to profile with large vaults |
| Cancel generation | 🔄 Pending | Not tested yet |
| Model switching flow | 🔄 Pending | Need to test in Obsidian |

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

### Model Download ✅ COMPLETE
- [x] Enable neural embeddings in settings
- [x] Confirmation modal appears with explanation
- [x] Click "Enable & Download" starts download
- [x] Progress modal shows download progress with detailed status
- [x] Model downloads successfully (~23MB)
- [x] "Model ready" message appears
- [x] Progress modal closes after success

### Embedding Generation ✅ COMPLETE
- [x] After model loads, embedding progress modal appears
- [x] Progress bar updates during processing
- [x] ETA shows and updates realistically
- [x] Notes processed counter increments
- [ ] Can cancel generation mid-process (not tested)
- [x] Completion message shows correct count (121 notes in 20.8s)
- [x] UI stays responsive during processing (fixed with event loop yielding)

### Cache Persistence ✅ FIXED
- [x] Cache files created in plugin folder (fixed "file already exists" error)
- [x] `embedding-metadata.json` created
- [x] `embeddings.bin` created
- [ ] Embeddings load from cache on restart (needs verification)
- [ ] Cache stats show in settings (needs verification)

### Hybrid Search with Embeddings 🔄 PENDING
- [ ] Type in a note to trigger suggestions
- [ ] Console shows "Using hybrid search (TF-IDF + Neural Embeddings)"
- [ ] Suggestions appear with semantic scores
- [ ] Suggestions quality improves vs TF-IDF only

### Fallback Behavior 🔄 PENDING
- [ ] Disable neural embeddings in settings
- [ ] Suggestions still work (TF-IDF + n-gram fallback)
- [ ] Console shows appropriate fallback message
- [ ] No errors when embeddings disabled

### Regenerate Function ✅ PARTIAL
- [x] Click "Regenerate" button in settings
- [x] Progress modal appears
- [ ] Only stale/missing embeddings are processed (not tested)
- [x] Cache updates correctly (fixed)

### Error Handling 🔄 PENDING
- [ ] Simulate network error during download
- [ ] Error message displays in modal
- [ ] Can close modal and retry
- [ ] Plugin continues working without embeddings

### Performance ✅ BASELINE
- [x] 121 notes: 20.8 seconds (~0.17s per note)
- [ ] Test with 500 notes
- [ ] Monitor memory usage during generation
- [x] Real-time suggestions stay responsive (fixed with event loop yielding)

---

## Rollout Strategy (As Implemented)

1. ✅ **Opt-in by default**: Neural embeddings disabled until user enables
2. ✅ **Confirmation before download**: Modal explains 23MB download + local processing
3. ✅ **Show progress**: Clear feedback during model download and embedding generation
4. ✅ **Graceful fallback**: Falls back to n-gram/context semantic when embeddings unavailable
5. ✅ **Cancel support**: User can cancel embedding generation mid-process

---

## Bugs Fixed (December 2, 2025)

| Bug | Root Cause | Fix Applied |
|-----|------------|-------------|
| WASM files not loading from CDN | `@xenova/transformers` detects `RUNNING_LOCALLY=true` in Electron and overwrites wasmPaths with `/dist/` | Set `env.backends.onnx.wasm.wasmPaths` to CDN URL AFTER importing transformers |
| UI freeze during batch processing | ONNX inference is CPU-bound and blocks main thread | Added `yieldToEventLoop()` using `setTimeout(0)` after each embedding |
| "Folder already exists" error | `getAbstractFileByPath()` returns null for .obsidian folders | Wrapped `createFolder()` in try/catch, continue on "already exists" |
| "File already exists" error | Same Obsidian API quirk for files | Fallback to `adapter.write()` and `adapter.writeBinary()` |
| Poor progress feedback | Status messages too generic | Added detailed step-by-step messages and note names |

**Git Commits**:
1. `Fix: Neural embeddings WASM loading in Obsidian/Electron`
2. `Fix: UI freeze during batch embedding generation`
3. `Improve: Detailed progress feedback during model loading`
4. `Fix: Handle 'File already exists' error in embedding cache`

---

## Known Limitations

1. **First-time download**: Requires ~23MB download (cached by browser after)
2. **Processing time**: ~0.17 seconds per note (measured with 121 notes)
3. **Memory usage**: Model uses ~100-200MB RAM when loaded
4. **Storage**: Binary cache grows with vault size (~1.5KB per note)
5. **Electron quirk**: WASM paths must be set after library import

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

**Phase 3 Status**: Core functionality + model selection complete. Users can now choose between 4 models. Next: test model switching flow in Obsidian and verify hybrid search improvements.
