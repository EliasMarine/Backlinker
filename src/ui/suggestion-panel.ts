/**
 * Suggestion Panel for Smart Links
 *
 * Sidebar panel that displays real-time link suggestions
 * Allows one-click insertion of suggested links
 */

import { ItemView, WorkspaceLeaf, TFile, MarkdownView, Notice } from 'obsidian';
import { LinkSuggestion, SmartLinksSettings } from '../types';
import SmartLinksPlugin from '../../main';

export const SUGGESTION_PANEL_VIEW_TYPE = 'smart-links-suggestion-panel';

/**
 * Suggestion Panel View
 * Displays link suggestions in the sidebar
 */
export class SuggestionPanelView extends ItemView {
  plugin: SmartLinksPlugin;
  suggestions: LinkSuggestion[] = [];
  settings: SmartLinksSettings;

  constructor(leaf: WorkspaceLeaf, plugin: SmartLinksPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.settings = plugin.settings;
  }

  getViewType(): string {
    return SUGGESTION_PANEL_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Smart Links';
  }

  getIcon(): string {
    return 'link';
  }

  async onOpen() {
    this.containerEl = this.contentEl;
    this.containerEl.empty();
    this.containerEl.addClass('smart-links-panel');
    this.render();
  }

  async onClose() {
    this.containerEl.empty();
  }

  /**
   * Update suggestions and re-render
   */
  updateSuggestions(suggestions: LinkSuggestion[]) {
    this.suggestions = suggestions;
    this.render();
  }

  /**
   * Render the panel
   */
  private render() {
    this.containerEl.empty();

    // Header
    const header = this.containerEl.createDiv('smart-links-header');
    header.createEl('h4', { text: '🔗 Smart Links' });

    // Status
    const statusEl = header.createDiv('smart-links-status');

    if (this.suggestions.length === 0) {
      statusEl.setText('No suggestions');
      statusEl.addClass('smart-links-status-empty');

      // Show empty state message
      const emptyState = this.containerEl.createDiv('smart-links-empty-state');
      emptyState.createEl('p', {
        text: 'Start typing to see link suggestions...'
      });
    } else {
      statusEl.setText(`${this.suggestions.length} suggestion${this.suggestions.length > 1 ? 's' : ''}`);
      statusEl.addClass('smart-links-status-active');

      // Render suggestions
      this.renderSuggestions();
    }

    // Last updated timestamp
    const footer = this.containerEl.createDiv('smart-links-footer');
    footer.setText(`Updated: ${new Date().toLocaleTimeString()}`);
  }

  /**
   * Render suggestion list
   */
  private renderSuggestions() {
    const listEl = this.containerEl.createDiv('smart-links-list');

    for (const suggestion of this.suggestions) {
      this.renderSuggestion(listEl, suggestion);
    }
  }

  /**
   * Render a single suggestion item
   */
  private renderSuggestion(container: HTMLElement, suggestion: LinkSuggestion) {
    const itemEl = container.createDiv('smart-links-item');

    // Header row with title and score
    const headerEl = itemEl.createDiv('smart-links-item-header');

    // Note title
    const titleEl = headerEl.createDiv('smart-links-item-title');
    titleEl.setText(suggestion.targetTitle || this.getNoteName(suggestion.targetNote));

    // Score badge
    if (this.settings.showConfidenceScores) {
      const scorePercent = Math.round(suggestion.finalScore * 100);
      const scoreEl = headerEl.createDiv('smart-links-item-score-badge');
      scoreEl.setText(`${scorePercent}%`);
      // Add color class based on score
      if (scorePercent >= 70) {
        scoreEl.addClass('score-high');
      } else if (scorePercent >= 40) {
        scoreEl.addClass('score-medium');
      } else {
        scoreEl.addClass('score-low');
      }
    }

    // Folder path (if exists)
    if (suggestion.targetFolder) {
      const folderEl = itemEl.createDiv('smart-links-item-folder');
      folderEl.setText(`📁 ${suggestion.targetFolder}`);
    }

    // Content preview
    if (suggestion.contentPreview) {
      const previewEl = itemEl.createDiv('smart-links-item-preview');
      previewEl.setText(suggestion.contentPreview);
    }

    // Matched keywords
    if (suggestion.matchedKeywords && suggestion.matchedKeywords.length > 0) {
      const keywordsEl = itemEl.createDiv('smart-links-item-keywords');
      const label = keywordsEl.createSpan('smart-links-label');
      label.setText('Keywords: ');
      const keywords = keywordsEl.createSpan('smart-links-keyword-list');
      keywords.setText(suggestion.matchedKeywords.slice(0, 5).join(', '));
    }

    // Matched phrases (for semantic matches)
    if (suggestion.matchedPhrases && suggestion.matchedPhrases.length > 0) {
      const phrasesEl = itemEl.createDiv('smart-links-item-phrases');
      const label = phrasesEl.createSpan('smart-links-label');
      label.setText('Phrases: ');
      const phrases = phrasesEl.createSpan('smart-links-phrase-list');
      phrases.setText(suggestion.matchedPhrases.slice(0, 3).join(', '));
    }

    // Score breakdown (only show if both scores exist)
    if (this.settings.showConfidenceScores && suggestion.tfidfScore > 0 && suggestion.semanticScore && suggestion.semanticScore > 0) {
      const breakdownEl = itemEl.createDiv('smart-links-item-breakdown');
      const tfidfPercent = Math.round(suggestion.tfidfScore * 100);
      const semanticPercent = Math.round(suggestion.semanticScore * 100);
      breakdownEl.setText(`📊 TF-IDF: ${tfidfPercent}% | Semantic: ${semanticPercent}%`);
    }

    // Tags
    if (suggestion.targetTags && suggestion.targetTags.length > 0) {
      const tagsEl = itemEl.createDiv('smart-links-item-tags');
      for (const tag of suggestion.targetTags.slice(0, 3)) {
        const tagSpan = tagsEl.createSpan('smart-links-tag');
        tagSpan.setText(tag);
      }
    }

    // Action buttons
    const actionsEl = itemEl.createDiv('smart-links-item-actions');

    // Insert button
    const insertBtn = actionsEl.createEl('button', {
      text: '+ Insert Link',
      cls: 'smart-links-btn-insert'
    });

    insertBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.insertLink(suggestion);
    });

    // Open note button (preview)
    const openBtn = actionsEl.createEl('button', {
      text: 'Preview',
      cls: 'smart-links-btn-open'
    });
    openBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.openNote(suggestion.targetNote);
    });

    // Dismiss button
    const dismissBtn = actionsEl.createEl('button', {
      text: '✕',
      cls: 'smart-links-btn-dismiss'
    });
    dismissBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.dismissSuggestion(suggestion);
    });
  }

  /**
   * Insert link at cursor position
   */
  private async insertLink(suggestion: LinkSuggestion) {
    try {
      // Find the source note file
      const sourceFile = this.app.vault.getAbstractFileByPath(suggestion.sourceNote);

      if (!(sourceFile instanceof TFile)) {
        new Notice('Source note not found');
        return;
      }

      // Find the leaf containing the source file
      const leaves = this.app.workspace.getLeavesOfType('markdown');
      let targetLeaf = null;

      for (const leaf of leaves) {
        const view = leaf.view;
        if (view instanceof MarkdownView && view.file?.path === sourceFile.path) {
          targetLeaf = leaf;
          break;
        }
      }

      if (!targetLeaf) {
        // Open the file and insert
        const leaf = this.app.workspace.getLeaf(false);
        await leaf.openFile(sourceFile);
        const view = leaf.view;
        if (!(view instanceof MarkdownView) || !view.editor) {
          new Notice('Failed to open source note');
          return;
        }
        const editor = view.editor;
        const noteName = this.getNoteName(suggestion.targetNote);
        editor.replaceSelection(`[[${noteName}]]`);
      } else {
        // Use the existing editor
        const view = targetLeaf.view;
        if (!(view instanceof MarkdownView) || !view.editor) {
          new Notice('Editor not available');
          return;
        }

        const editor = view.editor;
        const noteName = this.getNoteName(suggestion.targetNote);

        // Insert wikilink at cursor
        editor.replaceSelection(`[[${noteName}]]`);
      }

      // Update suggestion status
      suggestion.status = 'applied';

      // Remove from current suggestions
      this.suggestions = this.suggestions.filter(s => s.id !== suggestion.id);

      // Re-render
      this.render();

      new Notice(`Linked to: ${this.getNoteName(suggestion.targetNote)}`);
    } catch (error) {
      console.error('[Smart Links] Failed to insert link:', error);
      new Notice('Failed to insert link');
    }
  }

  /**
   * Open the suggested note
   */
  private async openNote(notePath: string) {
    try {
      const file = this.app.vault.getAbstractFileByPath(notePath);

      if (!(file instanceof TFile)) {
        new Notice(`Note not found: ${notePath}`);
        return;
      }

      await this.app.workspace.getLeaf(false).openFile(file);
    } catch (error) {
      console.error('[Smart Links] Failed to open note:', error);
      new Notice('Failed to open note');
    }
  }

  /**
   * Dismiss a suggestion
   */
  private dismissSuggestion(suggestion: LinkSuggestion) {
    suggestion.status = 'rejected';

    // Remove from current suggestions
    this.suggestions = this.suggestions.filter(s => s.id !== suggestion.id);

    // Re-render
    this.render();
  }

  /**
   * Get note name from path
   */
  private getNoteName(path: string): string {
    return path.replace(/\.md$/, '').split('/').pop() || path;
  }

  /**
   * Update settings
   */
  updateSettings(settings: SmartLinksSettings) {
    this.settings = settings;
    this.render();
  }
}
