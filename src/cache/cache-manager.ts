import { App } from 'obsidian';
import { VaultCache, SerializedVaultCache, NoteIndex, SerializedNoteIndex } from '../types';

/**
 * Manages persistent caching of vault index
 */
export class CacheManager {
  private app: App;
  private pluginDataDir: string;

  constructor(app: App) {
    this.app = app;
    this.pluginDataDir = '.obsidian/plugins/smart-links';
  }

  /**
   * Save cache to disk
   */
  async saveCache(cache: VaultCache): Promise<void> {
    try {
      const serialized = this.serializeCache(cache);
      const cacheJson = JSON.stringify(serialized, null, 2);

      await this.ensureDataDir();
      await this.app.vault.adapter.write(
        `${this.pluginDataDir}/cache.json`,
        cacheJson
      );

      console.log('[Smart Links] Cache saved successfully');
    } catch (error) {
      console.error('[Smart Links] Error saving cache:', error);
      throw error;
    }
  }

  /**
   * Load cache from disk
   */
  async loadCache(): Promise<VaultCache | null> {
    try {
      const cacheExists = await this.app.vault.adapter.exists(
        `${this.pluginDataDir}/cache.json`
      );

      if (!cacheExists) {
        console.log('[Smart Links] No cache file found');
        return null;
      }

      const cacheJson = await this.app.vault.adapter.read(
        `${this.pluginDataDir}/cache.json`
      );

      const serialized: SerializedVaultCache = JSON.parse(cacheJson);
      const cache = this.deserializeCache(serialized);

      console.log('[Smart Links] Cache loaded successfully:', cache.totalDocuments, 'notes');
      return cache;
    } catch (error) {
      console.error('[Smart Links] Error loading cache:', error);
      return null;
    }
  }

  /**
   * Clear cache from disk
   */
  async clearCache(): Promise<void> {
    try {
      const cacheExists = await this.app.vault.adapter.exists(
        `${this.pluginDataDir}/cache.json`
      );

      if (cacheExists) {
        await this.app.vault.adapter.remove(`${this.pluginDataDir}/cache.json`);
        console.log('[Smart Links] Cache cleared successfully');
      }
    } catch (error) {
      console.error('[Smart Links] Error clearing cache:', error);
      throw error;
    }
  }

  /**
   * Create an empty cache
   */
  createEmptyCache(): VaultCache {
    return {
      notes: new Map(),
      documentFrequency: new Map(),
      totalDocuments: 0,
      lastFullAnalysis: 0,
      embeddingsEnabled: false,
      version: '1.0.0'
    };
  }

  /**
   * Convert cache to serializable format
   */
  private serializeCache(cache: VaultCache): SerializedVaultCache {
    const serializedNotes: Record<string, SerializedNoteIndex> = {};

    for (const [path, note] of cache.notes.entries()) {
      serializedNotes[path] = {
        path: note.path,
        title: note.title,
        content: note.content,
        cleanContent: note.cleanContent,
        keywords: note.keywords,
        existingLinks: note.existingLinks,
        headings: note.headings,
        tags: note.tags,
        lastModified: note.lastModified,
        tfidfVector: Object.fromEntries(note.tfidfVector),
        wordFrequency: Object.fromEntries(note.wordFrequency),
        embeddingVersion: note.embeddingVersion
      };
    }

    return {
      notes: serializedNotes,
      documentFrequency: Object.fromEntries(cache.documentFrequency),
      totalDocuments: cache.totalDocuments,
      lastFullAnalysis: cache.lastFullAnalysis,
      embeddingsEnabled: cache.embeddingsEnabled,
      version: cache.version
    };
  }

  /**
   * Convert serialized format back to cache
   */
  private deserializeCache(serialized: SerializedVaultCache): VaultCache {
    const notes = new Map<string, NoteIndex>();

    for (const [path, serializedNote] of Object.entries(serialized.notes)) {
      notes.set(path, {
        path: serializedNote.path,
        title: serializedNote.title,
        content: serializedNote.content,
        cleanContent: serializedNote.cleanContent,
        keywords: serializedNote.keywords,
        existingLinks: serializedNote.existingLinks,
        headings: serializedNote.headings,
        tags: serializedNote.tags,
        lastModified: serializedNote.lastModified,
        tfidfVector: new Map(Object.entries(serializedNote.tfidfVector)),
        wordFrequency: new Map(Object.entries(serializedNote.wordFrequency)),
        embeddingVersion: serializedNote.embeddingVersion
      });
    }

    return {
      notes,
      documentFrequency: new Map(Object.entries(serialized.documentFrequency)),
      totalDocuments: serialized.totalDocuments,
      lastFullAnalysis: serialized.lastFullAnalysis,
      embeddingsEnabled: serialized.embeddingsEnabled,
      version: serialized.version
    };
  }

  /**
   * Ensure plugin data directory exists
   */
  private async ensureDataDir(): Promise<void> {
    const exists = await this.app.vault.adapter.exists(this.pluginDataDir);
    if (!exists) {
      await this.app.vault.adapter.mkdir(this.pluginDataDir);
    }
  }

  /**
   * Get cache file statistics
   */
  async getCacheStats(): Promise<{
    exists: boolean;
    size?: number;
    lastModified?: number;
  }> {
    try {
      const cachePath = `${this.pluginDataDir}/cache.json`;
      const exists = await this.app.vault.adapter.exists(cachePath);

      if (!exists) {
        return { exists: false };
      }

      const stat = await this.app.vault.adapter.stat(cachePath);

      return {
        exists: true,
        size: stat?.size,
        lastModified: stat?.mtime
      };
    } catch (error) {
      console.error('[Smart Links] Error getting cache stats:', error);
      return { exists: false };
    }
  }

  /**
   * Check if cache is valid (not corrupted)
   */
  async isCacheValid(): Promise<boolean> {
    try {
      const cache = await this.loadCache();
      if (!cache) {
        return false;
      }

      // Basic validation
      return (
        cache.version !== undefined &&
        cache.notes instanceof Map &&
        cache.documentFrequency instanceof Map &&
        typeof cache.totalDocuments === 'number' &&
        cache.totalDocuments === cache.notes.size
      );
    } catch (error) {
      console.error('[Smart Links] Cache validation failed:', error);
      return false;
    }
  }
}
