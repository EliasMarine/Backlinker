/**
 * Embedding Cache for Smart Links
 *
 * Persists neural embeddings to disk for fast loading between sessions.
 * Uses a binary format for efficient storage of Float32Arrays.
 *
 * Storage format:
 * - metadata.json: Contains note paths, hashes, and offsets
 * - embeddings.bin: Raw binary Float32Array data
 */

import { App, TFile } from 'obsidian';
import { getModelConfig, getDefaultModelConfig } from '../types';

export interface CachedEmbeddingMetadata {
  notePath: string;
  contentHash: string;
  modelVersion: string;
  generatedAt: number;
  offset: number;  // Byte offset in binary file
}

export interface EmbeddingCacheMetadata {
  version: string;
  modelName: string;
  embeddingDimension: number;
  totalEmbeddings: number;
  lastSaved: number;
  entries: CachedEmbeddingMetadata[];
}

export interface EmbeddingCacheStats {
  totalEmbeddings: number;
  cacheSizeBytes: number;
  modelName: string;
  embeddingDimension: number;
  lastSaved: number | null;
}

const CACHE_VERSION = '1.0.0';

/**
 * Embedding Cache Manager
 * Handles persistence and retrieval of embedding vectors
 */
export class EmbeddingCache {
  private app: App;
  private pluginId: string;
  private embeddings: Map<string, Float32Array> = new Map();
  private contentHashes: Map<string, string> = new Map();
  private generatedTimes: Map<string, number> = new Map();
  private modelName: string;
  private embeddingDimension: number;
  private isDirty: boolean = false;
  private lastSaved: number | null = null;

  constructor(app: App, pluginId: string, modelName: string = 'Xenova/all-MiniLM-L6-v2') {
    this.app = app;
    this.pluginId = pluginId;
    this.modelName = modelName;
    // Get dimension from model config
    const modelConfig = getModelConfig(modelName);
    this.embeddingDimension = modelConfig?.dimension ?? getDefaultModelConfig().dimension;
  }

  /**
   * Get the current embedding dimension
   */
  getEmbeddingDimension(): number {
    return this.embeddingDimension;
  }

  /**
   * Get the plugin data folder path
   */
  private getPluginDataPath(): string {
    return `${this.app.vault.configDir}/plugins/${this.pluginId}`;
  }

  /**
   * Get the metadata file path
   */
  private getMetadataPath(): string {
    return `${this.getPluginDataPath()}/embedding-metadata.json`;
  }

  /**
   * Get the binary embeddings file path
   */
  private getBinaryPath(): string {
    return `${this.getPluginDataPath()}/embeddings.bin`;
  }

  /**
   * Load cached embeddings from disk
   */
  async load(): Promise<void> {
    try {
      const metadataPath = this.getMetadataPath();
      const binaryPath = this.getBinaryPath();

      // Check if cache files exist
      const metadataFile = this.app.vault.getAbstractFileByPath(metadataPath);
      const binaryFile = this.app.vault.getAbstractFileByPath(binaryPath);

      if (!metadataFile || !binaryFile) {
        return;
      }

      // Load metadata
      const metadataContent = await this.app.vault.read(metadataFile as TFile);
      const metadata: EmbeddingCacheMetadata = JSON.parse(metadataContent);

      // Validate version and model
      if (metadata.version !== CACHE_VERSION) {
        await this.clear();
        return;
      }

      if (metadata.modelName !== this.modelName) {
        await this.clear();
        return;
      }

      // Check dimension matches - if not, cache is incompatible
      if (metadata.embeddingDimension !== this.embeddingDimension) {
        await this.clear();
        return;
      }

      // Load binary data
      const binaryData = await this.app.vault.readBinary(binaryFile as TFile);
      const embeddingsArray = new Float32Array(binaryData);

      // Reconstruct embeddings map
      let skippedEntries = 0;
      for (const entry of metadata.entries) {
        const startIndex = entry.offset / 4;  // Convert byte offset to float index
        const endIndex = startIndex + this.embeddingDimension;

        // Validate bounds to handle corrupted cache files
        if (endIndex <= embeddingsArray.length) {
          const embedding = embeddingsArray.slice(startIndex, endIndex);
          this.embeddings.set(entry.notePath, embedding);
          this.contentHashes.set(entry.notePath, entry.contentHash);
          this.generatedTimes.set(entry.notePath, entry.generatedAt);
        } else {
          skippedEntries++;
        }
      }

      if (skippedEntries > 0) {
        this.isDirty = true; // Mark dirty to rebuild on next save
      }

      this.lastSaved = metadata.lastSaved;
      this.isDirty = false;

    } catch (error) {
      console.error('[EmbeddingCache] Failed to load cache:', error);
      // Clear corrupted cache
      this.embeddings.clear();
      this.contentHashes.clear();
      this.generatedTimes.clear();
    }
  }

  /**
   * Save cached embeddings to disk
   */
  async save(): Promise<void> {
    if (!this.isDirty && this.embeddings.size > 0) {
      return;
    }

    try {
      const pluginDataPath = this.getPluginDataPath();
      const metadataPath = this.getMetadataPath();
      const binaryPath = this.getBinaryPath();

      // Ensure plugin data directory exists
      // Note: getAbstractFileByPath may return null for .obsidian folders even when they exist
      const pluginDir = this.app.vault.getAbstractFileByPath(pluginDataPath);
      if (!pluginDir) {
        try {
          await this.app.vault.createFolder(pluginDataPath);
        } catch (e) {
          // Folder might already exist but not be detectable via getAbstractFileByPath
          // This is common for .obsidian/plugins folders
          if (!(e instanceof Error) || !e.message.includes('Folder already exists')) {
            throw e;
          }
          // If folder already exists, that's fine - continue with save
        }
      }

      // Build metadata and binary data
      const entries: CachedEmbeddingMetadata[] = [];
      const totalFloats = this.embeddings.size * this.embeddingDimension;
      const binaryArray = new Float32Array(totalFloats);
      let offset = 0;

      for (const [notePath, embedding] of this.embeddings) {
        // Copy embedding to binary array
        binaryArray.set(embedding, offset / 4);

        entries.push({
          notePath,
          contentHash: this.contentHashes.get(notePath) || '',
          modelVersion: this.modelName,
          generatedAt: this.generatedTimes.get(notePath) || Date.now(),
          offset
        });

        offset += this.embeddingDimension * 4;  // 4 bytes per float
      }

      const metadata: EmbeddingCacheMetadata = {
        version: CACHE_VERSION,
        modelName: this.modelName,
        embeddingDimension: this.embeddingDimension,
        totalEmbeddings: this.embeddings.size,
        lastSaved: Date.now(),
        entries
      };

      // Write files
      // Note: getAbstractFileByPath may return null for .obsidian files even when they exist
      // So we try to create first, and fall back to modify if file already exists

      // Write metadata
      try {
        const metadataFile = this.app.vault.getAbstractFileByPath(metadataPath);
        if (metadataFile) {
          await this.app.vault.modify(metadataFile as TFile, JSON.stringify(metadata, null, 2));
        } else {
          await this.app.vault.create(metadataPath, JSON.stringify(metadata, null, 2));
        }
      } catch (e) {
        // File might exist but not be detectable - try to get it by adapter
        if (e instanceof Error && e.message.includes('File already exists')) {
          // Use adapter to write directly
          await this.app.vault.adapter.write(metadataPath, JSON.stringify(metadata, null, 2));
        } else {
          throw e;
        }
      }

      // Write binary data
      try {
        const binaryFile = this.app.vault.getAbstractFileByPath(binaryPath);
        if (binaryFile) {
          await this.app.vault.modifyBinary(binaryFile as TFile, binaryArray.buffer);
        } else {
          await this.app.vault.createBinary(binaryPath, binaryArray.buffer);
        }
      } catch (e) {
        // File might exist but not be detectable - try to get it by adapter
        if (e instanceof Error && e.message.includes('File already exists')) {
          // Use adapter to write directly
          await this.app.vault.adapter.writeBinary(binaryPath, binaryArray.buffer);
        } else {
          throw e;
        }
      }

      this.lastSaved = metadata.lastSaved;
      this.isDirty = false;

    } catch (error) {
      console.error('[EmbeddingCache] Failed to save cache:', error);
      throw error;
    }
  }

  /**
   * Get embedding for a note
   * @returns Float32Array or null if not cached
   */
  get(notePath: string): Float32Array | null {
    return this.embeddings.get(notePath) || null;
  }

  /**
   * Set embedding for a note
   */
  set(notePath: string, embedding: Float32Array, contentHash: string): void {
    this.embeddings.set(notePath, embedding);
    this.contentHashes.set(notePath, contentHash);
    this.generatedTimes.set(notePath, Date.now());
    this.isDirty = true;
  }

  /**
   * Delete embedding for a note
   */
  delete(notePath: string): void {
    if (this.embeddings.has(notePath)) {
      this.embeddings.delete(notePath);
      this.contentHashes.delete(notePath);
      this.generatedTimes.delete(notePath);
      this.isDirty = true;
    }
  }

  /**
   * Check if a cached embedding is still valid
   * @param notePath - Path to the note
   * @param contentHash - Current content hash of the note
   * @returns true if cached embedding matches current content
   */
  isValid(notePath: string, contentHash: string): boolean {
    const cachedHash = this.contentHashes.get(notePath);
    return cachedHash === contentHash && this.embeddings.has(notePath);
  }

  /**
   * Check if note has a cached embedding
   */
  has(notePath: string): boolean {
    return this.embeddings.has(notePath);
  }

  /**
   * Get all cached embeddings
   */
  getAll(): Map<string, Float32Array> {
    return new Map(this.embeddings);
  }

  /**
   * Get all note paths with embeddings
   */
  getAllPaths(): string[] {
    return Array.from(this.embeddings.keys());
  }

  /**
   * Get number of cached embeddings
   */
  size(): number {
    return this.embeddings.size;
  }

  /**
   * Clear all cached embeddings
   */
  async clear(): Promise<void> {
    this.embeddings.clear();
    this.contentHashes.clear();
    this.generatedTimes.clear();
    this.isDirty = false;
    this.lastSaved = null;

    // Delete cache files
    try {
      const metadataPath = this.getMetadataPath();
      const binaryPath = this.getBinaryPath();

      const metadataFile = this.app.vault.getAbstractFileByPath(metadataPath);
      const binaryFile = this.app.vault.getAbstractFileByPath(binaryPath);

      if (metadataFile) {
        await this.app.vault.delete(metadataFile as TFile);
      }
      if (binaryFile) {
        await this.app.vault.delete(binaryFile as TFile);
      }
    } catch (error) {
      console.error('[EmbeddingCache] Failed to delete cache files:', error);
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): EmbeddingCacheStats {
    const cacheSizeBytes = this.embeddings.size * this.embeddingDimension * 4;

    return {
      totalEmbeddings: this.embeddings.size,
      cacheSizeBytes,
      modelName: this.modelName,
      embeddingDimension: this.embeddingDimension,
      lastSaved: this.lastSaved
    };
  }

  /**
   * Get human-readable cache size
   */
  getCacheSizeFormatted(): string {
    const bytes = this.embeddings.size * this.embeddingDimension * 4;

    if (bytes < 1024) {
      return `${bytes} B`;
    } else if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    } else {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
  }

  /**
   * Update model name and dimension (will invalidate cache if different)
   * @returns true if model changed
   */
  updateModelName(modelName: string): boolean {
    if (modelName !== this.modelName) {
      this.modelName = modelName;
      // Update dimension from model config
      const modelConfig = getModelConfig(modelName);
      this.embeddingDimension = modelConfig?.dimension ?? getDefaultModelConfig().dimension;
      return true;
    }
    return false;
  }

  /**
   * Get the current model name
   */
  getModelName(): string {
    return this.modelName;
  }

  /**
   * Check if cache needs to be saved
   */
  needsSave(): boolean {
    return this.isDirty;
  }

  /**
   * Rename a note path in the cache
   */
  rename(oldPath: string, newPath: string): void {
    const embedding = this.embeddings.get(oldPath);
    const contentHash = this.contentHashes.get(oldPath);
    const generatedTime = this.generatedTimes.get(oldPath);

    if (embedding && contentHash) {
      this.embeddings.delete(oldPath);
      this.contentHashes.delete(oldPath);
      this.generatedTimes.delete(oldPath);

      this.embeddings.set(newPath, embedding);
      this.contentHashes.set(newPath, contentHash);
      this.generatedTimes.set(newPath, generatedTime || Date.now());

      this.isDirty = true;
    }
  }
}

/**
 * Calculate a simple hash of content for cache invalidation
 * Uses a fast, non-cryptographic hash (djb2)
 */
export function calculateContentHash(content: string): string {
  let hash = 5381;
  for (let i = 0; i < content.length; i++) {
    hash = ((hash << 5) + hash) + content.charCodeAt(i);
    hash = hash & hash;  // Convert to 32-bit integer
  }
  return hash.toString(16);
}
