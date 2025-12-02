/**
 * Batch Linker - Orchestrates the batch auto-linking process
 *
 * Coordinates between:
 * - HybridScorer for finding similar notes
 * - KeywordMatcher for mapping keywords to notes
 * - InlineReplacer for safe text replacement
 * - BackupManager for backup/restore
 */

import { App, TFile } from 'obsidian';
import { NoteIndex, VaultCache, SmartLinksSettings } from '../types';
import { HybridScorer } from '../engines/hybrid-scorer';
import {
  processContent,
  Replacement,
  KeywordToReplace
} from './inline-replacer';
import {
  processHybridResults,
  flattenToKeywords,
  HybridResultForMatching
} from './keyword-matcher';
import { BackupManager, BackupEntry } from './backup-manager';

export interface BatchLinkNoteResult {
  notePath: string;
  noteTitle: string;
  originalContent: string;
  modifiedContent: string;
  replacements: Replacement[];
  error?: string;
}

export interface BatchLinkSummary {
  totalNotesProcessed: number;
  notesWithChanges: number;
  totalLinksAdded: number;
  errors: string[];
  results: BatchLinkNoteResult[];
  backupId?: string;
}

export interface BatchLinkOptions {
  previewOnly: boolean;
  confidenceThreshold: number;
  maxLinksPerNote: number;
}

export interface BatchProgress {
  phase: 'analyzing' | 'applying' | 'backup' | 'complete';
  current: number;
  total: number;
  currentNotePath?: string;
  message: string;
}

export type BatchProgressCallback = (progress: BatchProgress) => void;

/**
 * BatchLinker orchestrates the entire batch auto-linking process
 */
export class BatchLinker {
  private app: App;
  private cache: VaultCache;
  private hybridScorer: HybridScorer;
  private settings: SmartLinksSettings;
  private backupManager: BackupManager;
  private isCancelled: boolean = false;

  constructor(
    app: App,
    cache: VaultCache,
    hybridScorer: HybridScorer,
    settings: SmartLinksSettings
  ) {
    this.app = app;
    this.cache = cache;
    this.hybridScorer = hybridScorer;
    this.settings = settings;
    this.backupManager = new BackupManager(app);
  }

  /**
   * Cancel the current batch operation
   */
  cancel(): void {
    this.isCancelled = true;
  }

  /**
   * Reset cancellation state
   */
  reset(): void {
    this.isCancelled = false;
  }

  /**
   * Get the backup manager instance
   */
  getBackupManager(): BackupManager {
    return this.backupManager;
  }

  /**
   * Process a single note and find replacements
   */
  async processNote(
    noteIndex: NoteIndex,
    options: BatchLinkOptions
  ): Promise<BatchLinkNoteResult> {
    const result: BatchLinkNoteResult = {
      notePath: noteIndex.path,
      noteTitle: noteIndex.title,
      originalContent: '',
      modifiedContent: '',
      replacements: []
    };

    try {
      // Get the file and read current content
      const file = this.app.vault.getAbstractFileByPath(noteIndex.path);
      if (!(file instanceof TFile)) {
        result.error = 'File not found';
        return result;
      }

      const content = await this.app.vault.read(file);
      result.originalContent = content;

      // Find similar notes using hybrid scorer
      const hybridResults = await this.hybridScorer.findSimilarNotes(
        noteIndex,
        options.maxLinksPerNote * 2 // Get extra to account for filtering
      );

      // Convert to the format expected by keyword matcher
      const resultsForMatching: HybridResultForMatching[] = hybridResults.map(r => ({
        note: r.note,
        tfidfScore: r.tfidfScore,
        semanticScore: r.semanticScore,
        finalScore: r.finalScore,
        matchedKeywords: r.matchedKeywords,
        matchedPhrases: r.matchedPhrases
      }));

      // Process hybrid results to find keyword matches
      const matchResults = processHybridResults(
        resultsForMatching,
        noteIndex,
        options.confidenceThreshold
      );

      // Flatten to a list of keywords to replace
      const keywordsToReplace = flattenToKeywords(
        matchResults,
        options.maxLinksPerNote
      );

      // Debug logging
      if (hybridResults.length > 0) {
        console.log(`[BatchLinker] Note "${noteIndex.title}":`, {
          hybridResults: hybridResults.length,
          matchResults: matchResults.length,
          keywordsToReplace: keywordsToReplace.map(k => ({
            keyword: k.keyword,
            target: k.targetTitle,
            confidence: k.confidence.toFixed(3)
          }))
        });
      }

      if (keywordsToReplace.length === 0) {
        result.modifiedContent = content;
        return result;
      }

      // Process content and find safe replacement positions
      const processResult = processContent(
        content,
        keywordsToReplace,
        options.maxLinksPerNote
      );

      result.modifiedContent = processResult.modifiedContent;
      result.replacements = processResult.replacements;

    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      console.error(`[BatchLinker] Error processing ${noteIndex.path}:`, error);
    }

    return result;
  }

  /**
   * Process all notes in the vault
   */
  async processVault(
    options: BatchLinkOptions,
    progressCallback?: BatchProgressCallback
  ): Promise<BatchLinkSummary> {
    this.reset();

    const summary: BatchLinkSummary = {
      totalNotesProcessed: 0,
      notesWithChanges: 0,
      totalLinksAdded: 0,
      errors: [],
      results: []
    };

    // Get all indexed notes
    const allNotes = Array.from(this.cache.notes.values());

    // Filter out notes that should be excluded
    const notesToProcess = allNotes.filter(note => {
      // Skip notes that are too short
      if ((note.content?.length || 0) < this.settings.minNoteLength) {
        return false;
      }

      // Skip notes in excluded folders
      for (const folder of this.settings.excludedFolders) {
        if (note.path.startsWith(folder + '/')) {
          return false;
        }
      }

      // Skip notes with excluded tags
      if (note.tags && note.tags.length > 0) {
        for (const tag of note.tags) {
          if (this.settings.excludedTags.includes(tag)) {
            return false;
          }
        }
      }

      return true;
    });

    const totalNotes = notesToProcess.length;
    console.log(`[BatchLinker] Processing ${totalNotes} notes`);

    progressCallback?.({
      phase: 'analyzing',
      current: 0,
      total: totalNotes,
      message: `Analyzing ${totalNotes} notes...`
    });

    // Process each note
    for (let i = 0; i < totalNotes; i++) {
      if (this.isCancelled) {
        console.log('[BatchLinker] Cancelled by user');
        break;
      }

      const noteIndex = notesToProcess[i];

      progressCallback?.({
        phase: 'analyzing',
        current: i + 1,
        total: totalNotes,
        currentNotePath: noteIndex.path,
        message: `Analyzing: ${noteIndex.title}`
      });

      const result = await this.processNote(noteIndex, options);
      summary.totalNotesProcessed++;

      if (result.error) {
        summary.errors.push(`${noteIndex.path}: ${result.error}`);
      } else if (result.replacements.length > 0) {
        summary.notesWithChanges++;
        summary.totalLinksAdded += result.replacements.length;
        summary.results.push(result);
      }

      // Yield to event loop
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    console.log(`[BatchLinker] Analysis complete: ${summary.totalLinksAdded} links in ${summary.notesWithChanges} notes`);

    return summary;
  }

  /**
   * Apply the changes from a preview
   */
  async applyChanges(
    results: BatchLinkNoteResult[],
    progressCallback?: BatchProgressCallback
  ): Promise<{ backupId: string; appliedCount: number }> {
    this.reset();

    // Filter to only results with changes
    const resultsWithChanges = results.filter(r => r.replacements.length > 0);
    const totalNotes = resultsWithChanges.length;

    if (totalNotes === 0) {
      throw new Error('No changes to apply');
    }

    // Phase 1: Create backup
    progressCallback?.({
      phase: 'backup',
      current: 0,
      total: totalNotes,
      message: 'Creating backup...'
    });

    const backupEntries: BackupEntry[] = resultsWithChanges.map(r => ({
      path: r.notePath,
      content: r.originalContent
    }));

    const totalLinksAdded = resultsWithChanges.reduce(
      (sum, r) => sum + r.replacements.length,
      0
    );

    const backup = await this.backupManager.createBackup(
      backupEntries,
      totalLinksAdded
    );

    console.log(`[BatchLinker] Created backup ${backup.id}`);

    // Phase 2: Apply changes
    let appliedCount = 0;

    for (let i = 0; i < totalNotes; i++) {
      if (this.isCancelled) {
        console.log('[BatchLinker] Apply cancelled by user');
        break;
      }

      const result = resultsWithChanges[i];

      progressCallback?.({
        phase: 'applying',
        current: i + 1,
        total: totalNotes,
        currentNotePath: result.notePath,
        message: `Applying: ${result.noteTitle}`
      });

      try {
        const file = this.app.vault.getAbstractFileByPath(result.notePath);
        if (file instanceof TFile) {
          await this.app.vault.modify(file, result.modifiedContent);
          appliedCount++;
        }
      } catch (error) {
        console.error(`[BatchLinker] Failed to apply changes to ${result.notePath}:`, error);
      }

      // Yield to event loop
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    progressCallback?.({
      phase: 'complete',
      current: appliedCount,
      total: totalNotes,
      message: `Applied ${totalLinksAdded} links to ${appliedCount} notes`
    });

    console.log(`[BatchLinker] Applied changes to ${appliedCount}/${totalNotes} notes`);

    return {
      backupId: backup.id,
      appliedCount
    };
  }

  /**
   * Run the complete batch auto-link process
   * If previewOnly is false, immediately applies changes
   */
  async runBatchAutoLink(
    options: BatchLinkOptions,
    progressCallback?: BatchProgressCallback
  ): Promise<BatchLinkSummary> {
    // First, analyze the vault
    const summary = await this.processVault(options, progressCallback);

    // If not preview-only and we have changes, apply them
    if (!options.previewOnly && summary.results.length > 0 && !this.isCancelled) {
      const { backupId, appliedCount } = await this.applyChanges(
        summary.results,
        progressCallback
      );
      summary.backupId = backupId;

      // Update summary with actual applied count
      if (appliedCount !== summary.notesWithChanges) {
        summary.notesWithChanges = appliedCount;
      }
    }

    return summary;
  }
}
