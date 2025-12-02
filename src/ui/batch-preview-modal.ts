/**
 * Batch Preview Modal for Smart Links
 *
 * Shows a detailed preview of all changes that will be made
 * before applying batch auto-linking.
 *
 * Features:
 * - Summary statistics
 * - Expandable list of notes with changes
 * - Context snippets for each replacement
 * - Cancel and Apply buttons
 */

import { App, Modal } from 'obsidian';
import { BatchLinkNoteResult, BatchLinkSummary } from '../batch/batch-linker';

export type PreviewResult = 'apply' | 'cancel';

/**
 * Preview Modal for batch linking operations
 */
export class BatchPreviewModal extends Modal {
  private summary: BatchLinkSummary;
  private onResultCallback?: (result: PreviewResult) => void;
  private expandedNotes: Set<string> = new Set();

  constructor(app: App, summary: BatchLinkSummary) {
    super(app);
    this.summary = summary;
  }

  /**
   * Set result callback
   */
  onResult(callback: (result: PreviewResult) => void): this {
    this.onResultCallback = callback;
    return this;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('smart-links-batch-preview-modal');

    // Title
    contentEl.createEl('h2', {
      text: 'Auto-Link Preview',
      cls: 'smart-links-modal-title'
    });

    // Summary section
    this.renderSummary(contentEl);

    // Results list
    if (this.summary.results.length > 0) {
      this.renderResultsList(contentEl);
    } else {
      this.renderNoChanges(contentEl);
    }

    // Warning about backup
    if (this.summary.results.length > 0) {
      const warningEl = contentEl.createDiv('smart-links-batch-warning');
      warningEl.createSpan({ text: 'A backup will be created before applying changes.' });
    }

    // Button container
    this.renderButtons(contentEl);
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }

  private renderSummary(container: HTMLElement): void {
    const summaryEl = container.createDiv('smart-links-batch-summary');

    if (this.summary.results.length > 0) {
      summaryEl.createEl('div', {
        text: `${this.summary.totalLinksAdded} links will be added across ${this.summary.notesWithChanges} notes`,
        cls: 'smart-links-batch-summary-main'
      });
    } else {
      summaryEl.createEl('div', {
        text: 'No links to add',
        cls: 'smart-links-batch-summary-main'
      });
    }

    const statsEl = summaryEl.createDiv('smart-links-batch-stats');
    statsEl.createSpan({
      text: `${this.summary.totalNotesProcessed} notes analyzed`
    });

    if (this.summary.errors.length > 0) {
      statsEl.createSpan({
        text: ` | ${this.summary.errors.length} errors`,
        cls: 'smart-links-error-count'
      });
    }
  }

  private renderResultsList(container: HTMLElement): void {
    const listContainer = container.createDiv('smart-links-batch-list');

    // Limit display to avoid performance issues
    const maxDisplay = 50;
    const results = this.summary.results.slice(0, maxDisplay);

    for (const result of results) {
      this.renderNoteResult(listContainer, result);
    }

    if (this.summary.results.length > maxDisplay) {
      listContainer.createDiv({
        text: `...and ${this.summary.results.length - maxDisplay} more notes`,
        cls: 'smart-links-batch-more'
      });
    }
  }

  private renderNoteResult(container: HTMLElement, result: BatchLinkNoteResult): void {
    const noteEl = container.createDiv('smart-links-batch-note');
    const isExpanded = this.expandedNotes.has(result.notePath);

    // Header (clickable to expand/collapse)
    const headerEl = noteEl.createDiv('smart-links-batch-note-header');
    headerEl.addEventListener('click', () => {
      if (this.expandedNotes.has(result.notePath)) {
        this.expandedNotes.delete(result.notePath);
      } else {
        this.expandedNotes.add(result.notePath);
      }
      // Re-render this note
      noteEl.empty();
      this.renderNoteContent(noteEl, result, !isExpanded);
    });

    this.renderNoteContent(noteEl, result, isExpanded);
  }

  private renderNoteContent(
    noteEl: HTMLElement,
    result: BatchLinkNoteResult,
    isExpanded: boolean
  ): void {
    // Header
    const headerEl = noteEl.createDiv('smart-links-batch-note-header');

    // Expand/collapse icon
    const iconEl = headerEl.createSpan('smart-links-batch-expand-icon');
    iconEl.setText(isExpanded ? '▼' : '▶');

    // Note title
    headerEl.createSpan({
      text: result.noteTitle,
      cls: 'smart-links-batch-note-title'
    });

    // Link count badge
    headerEl.createSpan({
      text: `+${result.replacements.length}`,
      cls: 'smart-links-batch-link-count'
    });

    // Make header clickable
    headerEl.addEventListener('click', () => {
      if (this.expandedNotes.has(result.notePath)) {
        this.expandedNotes.delete(result.notePath);
      } else {
        this.expandedNotes.add(result.notePath);
      }
      noteEl.empty();
      this.renderNoteContent(noteEl, result, !isExpanded);
    });

    // Replacements (if expanded)
    if (isExpanded) {
      const replacementsEl = noteEl.createDiv('smart-links-batch-replacements');

      for (const replacement of result.replacements) {
        const repEl = replacementsEl.createDiv('smart-links-batch-replacement');

        // Keyword -> Target
        const mappingEl = repEl.createDiv('smart-links-batch-mapping');
        mappingEl.createSpan({
          text: `"${replacement.originalText}"`,
          cls: 'smart-links-batch-keyword'
        });
        mappingEl.createSpan({
          text: ' → ',
          cls: 'smart-links-batch-arrow'
        });
        mappingEl.createSpan({
          text: replacement.replacementText,
          cls: 'smart-links-batch-target'
        });

        // Context
        const contextEl = repEl.createDiv('smart-links-batch-context');
        contextEl.createSpan({ text: replacement.contextBefore });
        contextEl.createSpan({
          text: replacement.originalText,
          cls: 'smart-links-batch-highlight'
        });
        contextEl.createSpan({ text: replacement.contextAfter });
      }
    }
  }

  private renderNoChanges(container: HTMLElement): void {
    const emptyEl = container.createDiv('smart-links-batch-empty');
    emptyEl.createEl('p', {
      text: 'No suitable links were found to add.'
    });
    emptyEl.createEl('p', {
      text: 'This could mean your notes are already well-linked, or the confidence threshold is set too high.',
      cls: 'smart-links-muted'
    });
  }

  private renderButtons(container: HTMLElement): void {
    const buttonContainer = container.createDiv('smart-links-batch-buttons');

    // Cancel button
    const cancelButton = buttonContainer.createEl('button', {
      text: 'Cancel',
      cls: 'smart-links-cancel-button'
    });
    cancelButton.addEventListener('click', () => {
      this.onResultCallback?.('cancel');
      this.close();
    });

    // Apply button (only if there are changes)
    if (this.summary.results.length > 0) {
      const applyButton = buttonContainer.createEl('button', {
        text: `Apply ${this.summary.totalLinksAdded} Links`,
        cls: 'mod-cta smart-links-apply-button'
      });
      applyButton.addEventListener('click', () => {
        this.onResultCallback?.('apply');
        this.close();
      });
    }
  }
}
