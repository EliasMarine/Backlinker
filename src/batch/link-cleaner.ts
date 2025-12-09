/**
 * Link Cleaner - Removes wiki-links from notes
 *
 * Provides functionality to:
 * 1. Remove all [[wiki-links]] from notes, keeping only display text
 * 2. Create backup before clearing
 * 3. Report on what was changed
 */

import { App, TFile, Notice } from 'obsidian';
import { BackupManager, BackupEntry } from './backup-manager';

export interface LinkCleanResult {
  notePath: string;
  noteTitle: string;
  linksRemoved: number;
  originalContent: string;
  cleanedContent: string;
}

export interface LinkCleanSummary {
  totalNotesProcessed: number;
  notesWithChanges: number;
  totalLinksRemoved: number;
  results: LinkCleanResult[];
  backupId?: string;
  errors: string[];
}

export interface LinkCleanProgress {
  phase: 'scanning' | 'backup' | 'cleaning' | 'complete';
  current: number;
  total: number;
  currentNotePath?: string;
  message: string;
}

export type LinkCleanProgressCallback = (progress: LinkCleanProgress) => void;

/**
 * Regex to match wiki-links:
 * - [[Target]] - simple link
 * - [[Target|Display Text]] - aliased link
 * - [[Target#Heading]] - link with heading
 * - [[Target#Heading|Display Text]] - link with heading and alias
 *
 * Also handles edge cases:
 * - #[[Target|Display]] - tag-prefixed links (malformed)
 */
const WIKI_LINK_REGEX = /#?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

/**
 * Remove wiki-links from content, keeping display text or target title
 *
 * Examples:
 * - [[Note Title]] → Note Title
 * - [[Note Title|Display Text]] → Display Text
 * - [[Folder/Note]] → Note
 * - #[[Note|Text]] → Text (removes malformed tag prefix)
 */
export function removeWikiLinks(content: string): {
  cleanedContent: string;
  linksRemoved: number;
} {
  let linksRemoved = 0;

  const cleanedContent = content.replace(WIKI_LINK_REGEX, (match, target, displayText) => {
    linksRemoved++;

    // If there's display text, use it
    if (displayText) {
      return displayText;
    }

    // Otherwise, extract title from target
    // Handle paths like "Folder/Note Title" → "Note Title"
    // Handle headings like "Note#Heading" → "Note"
    let title = target;

    // Remove path prefix
    if (title.includes('/')) {
      title = title.split('/').pop() || title;
    }

    // Remove heading suffix
    if (title.includes('#')) {
      title = title.split('#')[0];
    }

    return title.trim();
  });

  return { cleanedContent, linksRemoved };
}

/**
 * Count wiki-links in content without removing them
 */
export function countWikiLinks(content: string): number {
  const matches = content.match(WIKI_LINK_REGEX);
  return matches ? matches.length : 0;
}

/**
 * LinkCleaner class - orchestrates link removal across vault
 */
export class LinkCleaner {
  private app: App;
  private backupManager: BackupManager;
  private isCancelled: boolean = false;

  constructor(app: App, backupManager: BackupManager) {
    this.app = app;
    this.backupManager = backupManager;
  }

  /**
   * Cancel the current operation
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
   * Scan vault to preview what will be cleaned
   * Does NOT modify any files
   */
  async scanVault(
    progressCallback?: LinkCleanProgressCallback
  ): Promise<LinkCleanSummary> {
    this.reset();

    const summary: LinkCleanSummary = {
      totalNotesProcessed: 0,
      notesWithChanges: 0,
      totalLinksRemoved: 0,
      results: [],
      errors: []
    };

    const files = this.app.vault.getMarkdownFiles();
    const totalFiles = files.length;

    progressCallback?.({
      phase: 'scanning',
      current: 0,
      total: totalFiles,
      message: `Scanning ${totalFiles} notes...`
    });

    for (let i = 0; i < totalFiles; i++) {
      if (this.isCancelled) {
        break;
      }

      const file = files[i];

      progressCallback?.({
        phase: 'scanning',
        current: i + 1,
        total: totalFiles,
        currentNotePath: file.path,
        message: `Scanning: ${file.basename}`
      });

      try {
        const content = await this.app.vault.read(file);
        const linkCount = countWikiLinks(content);

        summary.totalNotesProcessed++;

        if (linkCount > 0) {
          const { cleanedContent, linksRemoved } = removeWikiLinks(content);

          summary.notesWithChanges++;
          summary.totalLinksRemoved += linksRemoved;

          summary.results.push({
            notePath: file.path,
            noteTitle: file.basename,
            linksRemoved,
            originalContent: content,
            cleanedContent
          });
        }
      } catch (error) {
        summary.errors.push(`${file.path}: ${(error as Error).message}`);
      }

      // Yield to event loop (MessageChannel avoids background throttling)
      if (i % 50 === 0) {
        await new Promise<void>(resolve => {
          const channel = new MessageChannel();
          channel.port1.onmessage = () => resolve();
          channel.port2.postMessage('');
        });
      }
    }

    progressCallback?.({
      phase: 'complete',
      current: totalFiles,
      total: totalFiles,
      message: `Found ${summary.totalLinksRemoved} links in ${summary.notesWithChanges} notes`
    });

    return summary;
  }

  /**
   * Apply link cleaning to all notes
   * Creates backup first, then removes links
   */
  async cleanAllLinks(
    progressCallback?: LinkCleanProgressCallback
  ): Promise<LinkCleanSummary> {
    this.reset();

    // First, scan to get what needs to be cleaned
    const scanResult = await this.scanVault((progress) => {
      progressCallback?.({
        ...progress,
        phase: 'scanning'
      });
    });

    if (scanResult.notesWithChanges === 0) {
      progressCallback?.({
        phase: 'complete',
        current: 0,
        total: 0,
        message: 'No links found to remove'
      });
      return scanResult;
    }

    if (this.isCancelled) {
      return scanResult;
    }

    // Create backup
    progressCallback?.({
      phase: 'backup',
      current: 0,
      total: scanResult.notesWithChanges,
      message: 'Creating backup...'
    });

    const backupEntries: BackupEntry[] = scanResult.results.map(r => ({
      path: r.notePath,
      content: r.originalContent,
      linksAdded: -r.linksRemoved // Negative because we're removing
    }));

    const backup = await this.backupManager.createBackup(
      backupEntries,
      -scanResult.totalLinksRemoved,
      {
        description: `Clear all links: Removed ${scanResult.totalLinksRemoved} links from ${scanResult.notesWithChanges} notes`,
        triggeredBy: 'clear-all-links'
      }
    );

    scanResult.backupId = backup.id;

    if (this.isCancelled) {
      return scanResult;
    }

    // Apply changes
    const totalToClean = scanResult.results.length;
    let cleaned = 0;

    for (const result of scanResult.results) {
      if (this.isCancelled) {
        break;
      }

      progressCallback?.({
        phase: 'cleaning',
        current: cleaned + 1,
        total: totalToClean,
        currentNotePath: result.notePath,
        message: `Cleaning: ${result.noteTitle}`
      });

      try {
        const file = this.app.vault.getAbstractFileByPath(result.notePath);
        if (file instanceof TFile) {
          await this.app.vault.modify(file, result.cleanedContent);
          cleaned++;
        }
      } catch (error) {
        scanResult.errors.push(`Failed to clean ${result.notePath}: ${(error as Error).message}`);
      }

      // Yield to event loop (MessageChannel avoids background throttling)
      await new Promise<void>(resolve => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => resolve();
        channel.port2.postMessage('');
      });
    }

    progressCallback?.({
      phase: 'complete',
      current: cleaned,
      total: totalToClean,
      message: `Removed ${scanResult.totalLinksRemoved} links from ${cleaned} notes`
    });

    return scanResult;
  }

  /**
   * Clean links from a single note (for testing/preview)
   */
  async cleanNote(file: TFile): Promise<LinkCleanResult | null> {
    try {
      const content = await this.app.vault.read(file);
      const linkCount = countWikiLinks(content);

      if (linkCount === 0) {
        return null;
      }

      const { cleanedContent, linksRemoved } = removeWikiLinks(content);

      return {
        notePath: file.path,
        noteTitle: file.basename,
        linksRemoved,
        originalContent: content,
        cleanedContent
      };
    } catch (error) {
      console.error(`[LinkCleaner] Failed to clean note ${file.path}:`, error);
      return null;
    }
  }
}
