import { App, TFile } from 'obsidian';
import { VaultCache, NoteIndex, SmartLinksSettings, ProgressCallback } from '../types';
import { ContentParser } from '../parsers/content-parser';
import { NLPProcessor } from '../nlp/nlp-processor';
import { TFIDFEngine } from '../engines/tfidf-engine';
import { CacheManager } from '../cache/cache-manager';

/**
 * Orchestrates the indexing of vault contents
 */
export class VaultIndexer {
  private app: App;
  private cache: VaultCache;
  private contentParser: ContentParser;
  private nlpProcessor: NLPProcessor;
  private tfidfEngine: TFIDFEngine;
  private cacheManager: CacheManager;
  private settings: SmartLinksSettings;

  constructor(
    app: App,
    cache: VaultCache,
    settings: SmartLinksSettings,
    cacheManager: CacheManager
  ) {
    this.app = app;
    this.cache = cache;
    this.settings = settings;
    this.cacheManager = cacheManager;

    // Initialize components
    this.contentParser = new ContentParser();
    this.nlpProcessor = new NLPProcessor();
    this.tfidfEngine = new TFIDFEngine(cache);
  }

  /**
   * Perform full vault analysis
   */
  async analyzeVault(progressCallback?: ProgressCallback): Promise<void> {
    console.log('[Smart Links] Starting full vault analysis...');
    const startTime = Date.now();

    try {
      // Get all markdown files
      const files = this.app.vault.getMarkdownFiles();
      const totalFiles = files.length;

      console.log('[Smart Links] Found', totalFiles, 'markdown files');

      if (progressCallback) {
        progressCallback(0, 'Starting analysis...');
      }

      // Reset cache for fresh analysis
      this.cache.notes.clear();
      this.cache.documentFrequency.clear();
      this.cache.totalDocuments = 0;

      // Phase 1: Parse and index all files
      let processedCount = 0;
      const batchSize = this.settings.batchSize;

      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        await this.indexBatch(batch);

        processedCount += batch.length;
        const progress = (processedCount / totalFiles) * 50; // 0-50%

        if (progressCallback) {
          progressCallback(
            progress,
            `Indexing notes: ${processedCount}/${totalFiles}`
          );
        }

        // Yield to UI
        await this.sleep(1);
      }

      // Update total documents count
      this.cache.totalDocuments = this.cache.notes.size;

      console.log('[Smart Links] Indexed', this.cache.totalDocuments, 'notes');
      console.log('[Smart Links] Found', this.cache.documentFrequency.size, 'unique terms');

      if (progressCallback) {
        progressCallback(60, 'Calculating TF-IDF vectors...');
      }

      // Phase 2: Calculate TF-IDF vectors for all notes
      this.tfidfEngine.recalculateAllVectors();

      if (progressCallback) {
        progressCallback(80, 'Resolving link references...');
      }

      // Phase 3: Resolve link target paths
      this.resolveAllLinkPaths();

      if (progressCallback) {
        progressCallback(90, 'Saving cache...');
      }

      // Phase 4: Save cache
      this.cache.lastFullAnalysis = Date.now();
      if (this.settings.cacheEnabled) {
        await this.cacheManager.saveCache(this.cache);
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log('[Smart Links] Analysis complete in', duration, 'seconds');

      if (progressCallback) {
        progressCallback(100, 'Analysis complete!');
      }
    } catch (error) {
      console.error('[Smart Links] Error during vault analysis:', error);
      throw error;
    }
  }

  /**
   * Index a batch of files
   */
  private async indexBatch(files: TFile[]): Promise<void> {
    for (const file of files) {
      try {
        // Check if file should be excluded
        if (this.shouldExcludeFile(file)) {
          continue;
        }

        // Read file content
        const content = await this.app.vault.read(file);

        // Check minimum length
        if (content.length < this.settings.minNoteLength) {
          continue;
        }

        // Parse content
        const parsed = this.contentParser.parse(content, file.path);

        // Check if note has excluded tags
        if (this.hasExcludedTags(parsed.tags)) {
          continue;
        }

        // Extract keywords, phrases, and word frequency
        const keywords = this.nlpProcessor.extractKeywords(parsed.cleanText);
        const phrases = this.nlpProcessor.extractPhrases(parsed.cleanText);
        const wordFrequency = this.nlpProcessor.getWordFrequency(parsed.cleanText);

        // Create note index
        const noteIndex: NoteIndex = {
          path: file.path,
          title: file.basename,
          content: content,
          cleanContent: parsed.cleanText,
          keywords: keywords,
          phrases: phrases,  // multi-word phrases for content-based linking
          existingLinks: parsed.links,
          headings: parsed.headings,
          tags: parsed.tags,
          lastModified: file.stat.mtime,
          tfidfVector: new Map(), // Will be calculated later
          wordFrequency: wordFrequency
        };

        // Add to cache
        this.cache.notes.set(file.path, noteIndex);

        // Update document frequency
        this.tfidfEngine.updateDocumentFrequency(noteIndex, true);
      } catch (error) {
        console.error('[Smart Links] Error indexing file:', file.path, error);
      }
    }
  }

  /**
   * Update index for a single note (incremental update)
   */
  async updateNote(file: TFile): Promise<void> {
    try {
      console.log('[Smart Links] Updating note:', file.path);

      // Check if file should be excluded
      if (this.shouldExcludeFile(file)) {
        // Remove from cache if it exists
        const existingNote = this.cache.notes.get(file.path);
        if (existingNote) {
          this.tfidfEngine.updateDocumentFrequency(existingNote, false);
          this.cache.notes.delete(file.path);
          this.cache.totalDocuments--;
        }
        return;
      }

      // Read file content
      const content = await this.app.vault.read(file);

      // Check minimum length
      if (content.length < this.settings.minNoteLength) {
        return;
      }

      // Parse content
      const parsed = this.contentParser.parse(content, file.path);

      // Check if note has excluded tags
      if (this.hasExcludedTags(parsed.tags)) {
        return;
      }

      // Remove old document frequency if note exists
      const existingNote = this.cache.notes.get(file.path);
      if (existingNote) {
        this.tfidfEngine.updateDocumentFrequency(existingNote, false);
      }

      // Extract keywords, phrases, and word frequency
      const keywords = this.nlpProcessor.extractKeywords(parsed.cleanText);
      const phrases = this.nlpProcessor.extractPhrases(parsed.cleanText);
      const wordFrequency = this.nlpProcessor.getWordFrequency(parsed.cleanText);

      // Create/update note index
      const noteIndex: NoteIndex = {
        path: file.path,
        title: file.basename,
        content: content,
        cleanContent: parsed.cleanText,
        keywords: keywords,
        phrases: phrases,  // multi-word phrases for content-based linking
        existingLinks: parsed.links,
        headings: parsed.headings,
        tags: parsed.tags,
        lastModified: file.stat.mtime,
        tfidfVector: new Map(), // Will be calculated below
        wordFrequency: wordFrequency
      };

      // Update document frequency
      this.tfidfEngine.updateDocumentFrequency(noteIndex, true);

      // Calculate TF-IDF vector
      noteIndex.tfidfVector = this.tfidfEngine.calculateTFIDFVector(noteIndex);

      // Add to cache
      this.cache.notes.set(file.path, noteIndex);

      if (!existingNote) {
        this.cache.totalDocuments++;
      }

      // Save cache
      if (this.settings.cacheEnabled) {
        await this.cacheManager.saveCache(this.cache);
      }

      console.log('[Smart Links] Note updated:', file.path);
    } catch (error) {
      console.error('[Smart Links] Error updating note:', file.path, error);
    }
  }

  /**
   * Remove a note from the index
   */
  async removeNote(file: TFile): Promise<void> {
    const existingNote = this.cache.notes.get(file.path);
    if (existingNote) {
      console.log('[Smart Links] Removing note from index:', file.path);

      // Update document frequency
      this.tfidfEngine.updateDocumentFrequency(existingNote, false);

      // Remove from cache
      this.cache.notes.delete(file.path);
      this.cache.totalDocuments--;

      // Save cache
      if (this.settings.cacheEnabled) {
        await this.cacheManager.saveCache(this.cache);
      }
    }
  }

  /**
   * Rename a note in the index
   */
  async renameNote(file: TFile, oldPath: string): Promise<void> {
    const existingNote = this.cache.notes.get(oldPath);
    if (existingNote) {
      console.log('[Smart Links] Renaming note in index:', oldPath, '->', file.path);

      // Update note data
      existingNote.path = file.path;
      existingNote.title = file.basename;

      // Move in cache
      this.cache.notes.delete(oldPath);
      this.cache.notes.set(file.path, existingNote);

      // Save cache
      if (this.settings.cacheEnabled) {
        await this.cacheManager.saveCache(this.cache);
      }
    }
  }

  /**
   * Check if file should be excluded from indexing
   */
  private shouldExcludeFile(file: TFile): boolean {
    // Check excluded folders
    for (const excludedFolder of this.settings.excludedFolders) {
      if (file.path.startsWith(excludedFolder)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if note has any excluded tags
   */
  private hasExcludedTags(tags: string[]): boolean {
    for (const tag of tags) {
      if (this.settings.excludedTags.includes(tag)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Resolve link target paths for all notes
   */
  private resolveAllLinkPaths(): void {
    const pathMap = new Map<string, string>(); // basename -> full path
    const titleMap = new Map<string, string>(); // title -> full path

    // Build lookup maps
    for (const note of this.cache.notes.values()) {
      const basename = note.title;
      pathMap.set(basename, note.path);
      titleMap.set(note.title, note.path);
    }

    // Resolve links
    for (const note of this.cache.notes.values()) {
      for (const link of note.existingLinks) {
        // Try to resolve by title/basename
        const resolvedPath =
          pathMap.get(link.targetTitle) ||
          titleMap.get(link.targetTitle) ||
          link.targetTitle;

        link.targetPath = resolvedPath;
      }
    }
  }

  /**
   * Get indexer statistics
   */
  getStatistics(): {
    totalNotes: number;
    totalTerms: number;
    totalLinks: number;
    avgKeywordsPerNote: number;
    lastAnalysis: Date | null;
  } {
    let totalLinks = 0;
    let totalKeywords = 0;

    for (const note of this.cache.notes.values()) {
      totalLinks += note.existingLinks.length;
      totalKeywords += note.keywords.length;
    }

    return {
      totalNotes: this.cache.totalDocuments,
      totalTerms: this.cache.documentFrequency.size,
      totalLinks,
      avgKeywordsPerNote:
        this.cache.totalDocuments > 0
          ? totalKeywords / this.cache.totalDocuments
          : 0,
      lastAnalysis: this.cache.lastFullAnalysis > 0
        ? new Date(this.cache.lastFullAnalysis)
        : null
    };
  }

  /**
   * Sleep for specified milliseconds (yield to UI)
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
