# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ⚠️ IMPORTANT: Check Progress File First!

**BEFORE responding to any prompt, you MUST:**
1. Read `documents/CURRENT_PROGRESS.md` to understand current project status
2. Check what's been tested vs what's just written
3. Review known issues and blockers
4. Understand the current phase and immediate priorities

**This progress file is the SOURCE OF TRUTH for project state.**

Do NOT assume features work just because code exists. Many components are written but completely untested.

---

## Project Overview

**Smart Links** is an Obsidian plugin that automatically suggests backlinks to relevant notes as you write. The plugin indexes your vault and provides real-time link suggestions, transforming the manual process of finding and creating connections into an effortless, automatic experience.

**Core Value Proposition**: Write naturally. Smart Links watches what you type and instantly suggests links to related notes in your vault—no searching, no context switching, just seamless knowledge connection.

## High-Level Architecture

### System Design Philosophy

1. **Real-Time First**: Suggestions appear as you write, not after manual analysis
2. **Hybrid Approach**: TF-IDF for speed + embeddings for semantic depth
3. **Progressive Enhancement**: Start fast with TF-IDF, enable embeddings when ready
4. **Local-First**: All processing on device, zero external dependencies
5. **User Control**: All suggestions require explicit approval (one-click insertion)

### Core Components

```
Plugin Entry (main.ts)
    ↓
├── Settings Manager (settings.ts)
├── Vault Indexer (indexing/vault-indexer.ts)
│   ├── Content Parser (parsers/content-parser.ts)
│   ├── NLP Processor (nlp/nlp-processor.ts)
│   └── Cache Manager (cache/cache-manager.ts)
├── Analysis Engines
│   ├── TF-IDF Engine (engines/tfidf-engine.ts) [always on]
│   ├── Embedding Engine (engines/embedding-engine.ts) [optional]
│   └── Hybrid Scorer (engines/hybrid-scorer.ts)
├── Real-Time Discovery
│   └── Link Discovery (discovery/link-discovery.ts)
└── UI Components
    ├── Suggestion Panel (ui/suggestion-panel.ts)
    └── Settings Tab (ui/settings-tab.ts)
```

## Core Data Structures

### NoteIndex (src/types/index.ts)
Represents a fully indexed note with all analysis data:
- Basic metadata: path, title, content, timestamps
- Extracted data: keywords, links, headings, tags
- TF-IDF vector (always computed)
- Embedding vector (optional, 384-dim Float32Array)

### LinkSuggestion (src/types/index.ts)
Represents a suggested connection between two notes:
- Source and target note paths
- Scoring: tfidfScore, embeddingScore, finalScore
- Context: matched keywords
- Status: pending/accepted/rejected/applied

### VaultCache (src/types/index.ts)
In-memory database of all indexed notes:
- Map of note paths to NoteIndex
- Document frequency map for IDF calculations
- Metadata: last analysis time, embeddings enabled, version

## Key Algorithms

### TF-IDF Similarity
**File**: `src/engines/tfidf-engine.ts`

1. **Term Frequency (TF)**: Count word occurrences in each note, normalized by note length
2. **Inverse Document Frequency (IDF)**: Log of (total docs / docs containing term)
3. **TF-IDF Vector**: Multiply TF × IDF for each term
4. **Cosine Similarity**: Dot product of normalized vectors (0-1 scale)

Used for: Fast keyword-based matching, always enabled

### Semantic Embeddings
**File**: `src/engines/embedding-engine.ts`

1. **Model**: all-MiniLM-L6-v2 via @xenova/transformers (WebAssembly)
2. **Process**: Text → 384-dim vector via sentence transformer
3. **Similarity**: Cosine similarity between embedding vectors
4. **Batching**: Process 8 notes at a time for efficiency

Used for: Deep conceptual understanding, optional feature

### Hybrid Scoring
**File**: `src/engines/hybrid-scorer.ts`

- Combines TF-IDF and embedding scores with configurable weights
- Default: 60% TF-IDF + 40% embeddings (when enabled)
- Falls back to TF-IDF only when embeddings disabled
- Threshold filtering based on combined score

### Real-Time Link Discovery
**File**: `src/discovery/link-discovery.ts`

Monitors active note and generates suggestions:
1. **Debounced Analysis**: Waits 300-500ms after typing stops
2. **Content Extraction**: Gets current note content
3. **Similarity Search**: Compares against indexed notes
4. **Filtering**: Removes already-linked notes
5. **Ranking**: Sorts by relevance score
6. **Suggestion Update**: Refreshes UI panel

## Development Commands

### Install Dependencies
```bash
npm install
```

### Development Build
```bash
npm run dev
```
Starts esbuild in watch mode. Changes to TypeScript files automatically rebuild main.js.

### Production Build
```bash
npm run build
```
Runs TypeScript type checking and creates optimized production bundle.

### Run Tests
```bash
npm test
```

### Version Bump
```bash
npm version [major|minor|patch]
```
Automatically updates manifest.json and versions.json.

## Local Testing

1. Run `npm run dev` to start build watcher
2. Create symbolic link to test vault:
   ```bash
   ln -s "$(pwd)" "/path/to/test-vault/.obsidian/plugins/smart-links"
   ```
3. Enable plugin in Obsidian Settings > Community Plugins
4. Reload Obsidian (Cmd/Ctrl+R) after changes
5. Open Developer Console (Cmd/Ctrl+Shift+I) to view logs

## Implementation Phases

### Phase 1: Core Foundation (Weeks 1-2)
**Status**: In Progress

**Components**:
- ✅ `src/types/index.ts` - All TypeScript interfaces
- ✅ `src/settings.ts` - Settings interface and defaults
- ✅ `src/parsers/content-parser.ts` - Markdown parsing
- ✅ `src/nlp/nlp-processor.ts` - Keyword extraction, stopword removal
- ✅ `src/engines/tfidf-engine.ts` - TF-IDF implementation
- ✅ `src/cache/cache-manager.ts` - Persist index to disk
- ✅ `src/indexing/vault-indexer.ts` - Orchestrates indexing

**Success Criteria**:
- Parse 1000 notes and generate TF-IDF vectors in <10 seconds
- Cache persists between sessions
- Settings UI functional

### Phase 2: Real-Time Suggestions (Weeks 3-4)
**Status**: Not Started

**Components**:
- `src/discovery/link-discovery.ts` - Real-time suggestion engine
- `src/ui/suggestion-panel.ts` - Sidebar panel UI
- `src/engines/hybrid-scorer.ts` - Score combination logic
- Active note monitoring with debouncing
- One-click link insertion

**Success Criteria**:
- Suggestions appear within 500ms of typing pause
- Panel updates smoothly without flickering
- Links insert at cursor position correctly
- Already-linked notes filtered out

### Phase 3: Embeddings Integration (Weeks 5-6)
**Status**: Not Started

**Components**:
- `src/engines/embedding-engine.ts` - Transformers.js integration
- Model loading UI with progress
- Batch embedding generation
- Hybrid scoring with embeddings

**Success Criteria**:
- Embeddings generate for test vault
- Hybrid scoring improves suggestion quality
- Toggle embeddings on/off without breaking TF-IDF
- Model loads in <5 seconds

### Phase 4: Polish & Release (Week 7-8)
**Status**: Not Started

**Tasks**:
- Performance optimization
- Edge case handling
- Documentation
- Beta testing
- Community release

## Key Implementation Patterns

### Working with Obsidian Vault

```typescript
// Get all markdown files
const files = this.app.vault.getMarkdownFiles();

// Read file content
const content = await this.app.vault.read(file);

// Modify file (insert link at cursor)
const editor = this.app.workspace.activeEditor?.editor;
if (editor) {
  editor.replaceSelection(`[[${noteTitle}]]`);
}

// Get file by path
const file = this.app.vault.getAbstractFileByPath(path);

// Access metadata cache
const cache = this.app.metadataCache.getFileCache(file);
```

### Real-Time Active Note Monitoring

```typescript
// In main.ts onload()
this.registerEvent(
  this.app.workspace.on('editor-change', (editor) => {
    // Debounce to avoid excessive analysis
    this.debounceAnalysis(editor);
  })
);

// Debounced analysis
private debounceAnalysis(editor: Editor) {
  if (this.debounceTimer) {
    clearTimeout(this.debounceTimer);
  }

  this.debounceTimer = setTimeout(async () => {
    const content = editor.getValue();
    await this.linkDiscovery.analyzeCurrent(content);
  }, 300); // 300ms debounce
}
```

### File Change Watching

```typescript
// In main.ts onload()
this.registerEvent(
  this.app.vault.on('modify', (file) => {
    if (file instanceof TFile) {
      this.vaultIndexer.updateNote(file);
    }
  })
);

this.registerEvent(
  this.app.vault.on('delete', (file) => {
    if (file instanceof TFile) {
      this.cache.notes.delete(file.path);
    }
  })
);

this.registerEvent(
  this.app.vault.on('rename', (file, oldPath) => {
    if (file instanceof TFile) {
      const note = this.cache.notes.get(oldPath);
      this.cache.notes.delete(oldPath);
      if (note) {
        note.path = file.path;
        this.cache.notes.set(file.path, note);
      }
    }
  })
);
```

### Settings Persistence

```typescript
// Settings are auto-saved to data.json in plugin folder
async loadSettings() {
  this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
}

async saveSettings() {
  await this.saveData(this.settings);
}
```

### Creating UI Elements

```typescript
// Sidebar panel
this.addRibbonIcon('link', 'Smart Links', () => {
  this.suggestionPanel.toggle();
});

// Settings tab
this.addSettingTab(new SmartLinksSettingTab(this.app, this));

// Status bar
this.statusBar = this.addStatusBarItem();
this.statusBar.setText('Smart Links: Ready');
```

## Performance Considerations

### Targets
- **Initial analysis**: <10 seconds for 1000 notes (TF-IDF only)
- **With embeddings**: <60 seconds for 1000 notes
- **Incremental update**: <100ms per note
- **Real-time suggestions**: <500ms latency
- **Memory usage**: <100MB for 5000 notes

### Optimization Techniques

1. **Batch Processing**: Process notes in configurable batches (default: 50)
2. **Incremental Indexing**: Only update changed notes
3. **Lazy Loading**: Load embeddings on demand
4. **Debouncing**: Throttle real-time suggestions (300ms after last keystroke)
5. **Caching**: Persist TF-IDF vectors and embeddings to disk
6. **Filtering**: Exclude already-linked notes from suggestions

## Cache Structure

```
.obsidian/
  plugins/
    smart-links/
      cache.json          # NoteIndex map, document frequencies
      embeddings.bin      # Binary Float32Array dump (optional)
      data.json           # User settings (auto-managed by Obsidian)
```

**Cache Format** (cache.json):
```json
{
  "version": "1.0.0",
  "lastFullAnalysis": 1699564800000,
  "totalDocuments": 1234,
  "embeddingsEnabled": false,
  "documentFrequency": {
    "term1": 45,
    "term2": 123
  },
  "notes": {
    "path/to/note.md": {
      "path": "path/to/note.md",
      "title": "Note Title",
      "keywords": ["keyword1", "keyword2"],
      "lastModified": 1699564800000,
      "tfidfVector": { "term1": 0.45, "term2": 0.23 }
    }
  }
}
```

## Error Handling

### Common Issues

1. **Model loading fails**: Fallback to TF-IDF only, show notification
2. **Cache corruption**: Delete cache.json, trigger re-analysis
3. **Large vault (10k+ notes)**: Suggest increasing batch size or disabling embeddings
4. **Memory issues**: Clear embedding cache, use TF-IDF only

### Debugging

Use console.log() for debugging; output appears in Obsidian Developer Console (Cmd/Ctrl+Shift+I):

```typescript
console.log('[Smart Links] Analyzing current note...');
console.log('[Smart Links] Found', suggestions.length, 'suggestions');
console.error('[Smart Links] Error:', error);
```

## Dependencies

### Core Dependencies

- **@xenova/transformers** (^2.6.0): WebAssembly transformers for embeddings
- **natural** (^6.0.0): NLP toolkit (tokenization, stemming)
- **compromise** (^14.0.0): Lightweight NLP
- **stopword** (^2.0.0): Stopword lists for multiple languages
- **fuzzysort** (^2.0.0): Fuzzy string matching

### Dev Dependencies

- **typescript** (^5.3.3): TypeScript compiler
- **esbuild** (^0.19.9): Fast bundler
- **jest** (^29.0.0): Testing framework
- **eslint** (^8.0.0): Linting
- **prettier** (^2.8.0): Code formatting

## Important Notes

- The built file (main.js) is gitignored and generated from src/
- Always update manifest.json version alongside package.json
- Obsidian API types come from the `obsidian` npm package
- Minimum Obsidian version: 1.4.0 (set in manifest.json)
- Plugin must be compatible across Windows, macOS, Linux
- No external API calls except optional model download on first use
- All user data stays local (privacy-first design)

## Testing Strategy

### Unit Tests
- TF-IDF calculations (cosine similarity)
- NLP processing (keyword extraction)
- Hybrid scoring logic
- Settings validation

### Integration Tests
- Full vault analysis workflow
- Incremental updates
- Cache persistence and loading
- Real-time suggestion generation

### Manual Testing Checklist
- [ ] Install plugin in test vault
- [ ] Run initial vault analysis
- [ ] Verify suggestions appear as you type
- [ ] Click to insert links at cursor
- [ ] Toggle embeddings on/off
- [ ] Check cache persists after restart
- [ ] Test with 100, 1000, 5000 note vaults
- [ ] Monitor memory usage
- [ ] Verify no network requests (except model download)

## Common Development Workflows

### Adding a New Command

1. Define command in `main.ts`:
```typescript
this.addCommand({
  id: 'my-command',
  name: 'My Command',
  callback: async () => {
    // Implementation
  }
});
```

2. Update CLAUDE.md with new command
3. Add to README.md usage section

### Adding a New Setting

1. Add to `SmartLinksSettings` interface in `src/types/index.ts`
2. Update `DEFAULT_SETTINGS` constant
3. Add UI control in `src/settings.ts` (SmartLinksSettingTab)
4. Use setting in relevant component
5. Document in README.md

### Modifying the Analysis Algorithm

1. Update algorithm in appropriate engine (`tfidf-engine.ts`, `embedding-engine.ts`, `hybrid-scorer.ts`)
2. Add/update unit tests
3. Update cache version if data structure changes
4. Test with sample vault
5. Document changes in CLAUDE.md

## Out of Scope (Not in MVP)

These features are explicitly **NOT included** in the current scope:

- ❌ Link health management / broken link detection
- ❌ Analytics dashboards or vault statistics
- ❌ Orphan note identification
- ❌ Graph visualization enhancements
- ❌ Multi-vault support
- ❌ Mobile support
- ❌ Auto-linking mode (automatic insertion without approval)
- ❌ Complex context finding (insert at specific location)
- ❌ Temporal analysis or connection tracking

Focus is exclusively on: **Real-time suggestion while writing + one-click insertion at cursor**

## Future Considerations (Post-MVP)

- Auto-linking mode (automatically apply high-confidence suggestions)
- Inline suggestions (show in editor, not just panel)
- Multi-vault analysis
- Mobile support
- Custom algorithms via plugin API

## Resources

- [Obsidian Plugin API Docs](https://docs.obsidian.md/Plugins)
- [Obsidian Sample Plugin](https://github.com/obsidianmd/obsidian-sample-plugin)
- [Transformers.js Docs](https://huggingface.co/docs/transformers.js)
- [Natural NLP Docs](https://github.com/NaturalNode/natural)

---

This architecture provides a focused, streamlined foundation for Smart Links. The real-time approach ensures seamless integration into writing workflows, while the hybrid TF-IDF + embeddings approach balances speed with semantic understanding. The local-first design preserves user privacy and control.
