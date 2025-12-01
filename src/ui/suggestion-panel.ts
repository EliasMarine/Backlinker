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
    console.log('[Smart Links] SuggestionPanelView.onOpen() called');
    this.containerEl = this.contentEl;
    this.containerEl.empty();
    this.containerEl.addClass('smart-links-panel');

    this.render();
    console.log('[Smart Links] Panel rendered');
  }

  async onClose() {
    this.containerEl.empty();
  }

  /**
   * Update suggestions and re-render
   */
  updateSuggestions(suggestions: LinkSuggestion[]) {
    console.log('[Smart Links] Panel.updateSuggestions() called with', suggestions.length, 'suggestions');
    this.suggestions = suggestions;
    this.render();
  }

  /**
   * Render the panel
   */
  private render() {
    console.log('[Smart Links] Panel.render() - rendering with', this.suggestions.length, 'suggestions');
    this.containerEl.empty();

    // Header
    const header = this.containerEl.createDiv('smart-links-header');
    header.createEl('h4', { text: '🔗 Smart Links' });

    // Status
    const statusEl = header.createDiv('smart-links-status');

    if (this.suggestions.length === 0) {
      console.log('[Smart Links] Panel.render() - showing empty state');
      statusEl.setText('No suggestions');
      statusEl.addClass('smart-links-status-empty');

      // Show empty state message
      const emptyState = this.containerEl.createDiv('smart-links-empty-state');
      emptyState.createEl('p', {
        text: 'Start typing to see link suggestions...'
      });
    } else {
      console.log('[Smart Links] Panel.render() - rendering', this.suggestions.length, 'suggestions');
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

    // Note title
    const titleEl = itemEl.createDiv('smart-links-item-title');
    titleEl.setText(`📄 ${this.getNoteName(suggestion.targetNote)}`);

    // Explanation (keywords/score)
    const explanationEl = itemEl.createDiv('smart-links-item-explanation');
    explanationEl.setText(suggestion.explanation);

    // Show confidence score if enabled
    if (this.settings.showConfidenceScores) {
      const scoreEl = itemEl.createDiv('smart-links-item-score');
      const scorePercent = Math.round(suggestion.finalScore * 100);
      scoreEl.setText(`${scorePercent}% match`);
    }

    // Action buttons
    const actionsEl = itemEl.createDiv('smart-links-item-actions');

    // Insert button
    const insertBtn = actionsEl.createEl('button', {
      text: 'Insert',
      cls: 'smart-links-btn-insert'
    });

    // Use click handler - now safe since we fixed the race condition in main.ts
    insertBtn.addEventListener('click', (e) => {
      console.log('[Smart Links] Insert button clicked');
      e.preventDefault();
      e.stopPropagation();
      this.insertLink(suggestion);
    });

    // Open note button (preview)
    const openBtn = actionsEl.createEl('button', {
      text: 'Open',
      cls: 'smart-links-btn-open'
    });
    openBtn.addEventListener('click', (e) => {
      console.log('[Smart Links] Open button clicked');
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
      console.log('[Smart Links] Dismiss button clicked');
      e.preventDefault();
      e.stopPropagation();
      this.dismissSuggestion(suggestion);
    });
  }

  /**
   * Insert link at cursor position
   */
  private async insertLink(suggestion: LinkSuggestion) {
    console.log('[Smart Links] Insert button clicked for:', suggestion.targetNote);

    try {
      const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);

      if (!activeView || !activeView.editor) {
        console.warn('[Smart Links] No active markdown editor found');
        new Notice('Please open a note to insert the link');
        return;
      }

      const editor = activeView.editor;
      const noteName = this.getNoteName(suggestion.targetNote);

      console.log('[Smart Links] Inserting link:', noteName);

      // Insert wikilink at cursor
      editor.replaceSelection(`[[${noteName}]]`);

      // Update suggestion status
      suggestion.status = 'applied';

      // Remove from current suggestions
      this.suggestions = this.suggestions.filter(s => s.id !== suggestion.id);

      // Re-render
      this.render();

      console.log('[Smart Links] ✓ Link inserted successfully');
      new Notice(`Linked to: ${noteName}`);
    } catch (error) {
      console.error('[Smart Links] Failed to insert link:', error);
      new Notice('Failed to insert link');
    }
  }

  /**
   * Open the suggested note
   */
  private async openNote(notePath: string) {
    console.log('[Smart Links] Open button clicked for:', notePath);

    try {
      const file = this.app.vault.getAbstractFileByPath(notePath);

      if (!(file instanceof TFile)) {
        console.warn('[Smart Links] File not found:', notePath);
        new Notice(`Note not found: ${notePath}`);
        return;
      }

      console.log('[Smart Links] Opening file:', file.path);
      await this.app.workspace.getLeaf(false).openFile(file);
      console.log('[Smart Links] ✓ File opened successfully');
    } catch (error) {
      console.error('[Smart Links] Failed to open note:', error);
      new Notice('Failed to open note');
    }
  }

  /**
   * Dismiss a suggestion
   */
  private dismissSuggestion(suggestion: LinkSuggestion) {
    console.log('[Smart Links] Dismiss button clicked for:', suggestion.targetNote);

    suggestion.status = 'rejected';

    // Remove from current suggestions
    this.suggestions = this.suggestions.filter(s => s.id !== suggestion.id);

    // Re-render
    this.render();

    console.log('[Smart Links] ✓ Suggestion dismissed');
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
