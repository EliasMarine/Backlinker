import { App, Notice, Plugin, TFile, WorkspaceLeaf } from 'obsidian';
import { SmartLinksSettings, DEFAULT_SETTINGS, VaultCache } from './src/types';
import { SmartLinksSettingTab } from './src/settings';
import { VaultIndexer } from './src/indexing/vault-indexer';
import { CacheManager } from './src/cache/cache-manager';
import { TFIDFEngine } from './src/engines/tfidf-engine';
// import { EmbeddingEngine } from './src/engines/embedding-engine'; // Disabled for Phase 2 - will re-enable in Phase 3
import { HybridScorer } from './src/engines/hybrid-scorer';
import { LinkDiscovery } from './src/discovery/link-discovery';
import { SuggestionPanelView, SUGGESTION_PANEL_VIEW_TYPE } from './src/ui/suggestion-panel';

/**
 * Smart Links - Intelligent Backlinking for Obsidian
 *
 * Main plugin class that orchestrates all components
 */
export default class SmartLinksPlugin extends Plugin {
  settings: SmartLinksSettings;
  cache: VaultCache;

  // Core components
  private vaultIndexer: VaultIndexer;
  private cacheManager: CacheManager;

  // Engines
  private tfidfEngine: TFIDFEngine;
  // private embeddingEngine: EmbeddingEngine; // Disabled for Phase 2 - will re-enable in Phase 3
  private hybridScorer: HybridScorer;

  // Discovery & UI
  private linkDiscovery: LinkDiscovery;
  private suggestionPanel: SuggestionPanelView | null = null;

  // State
  private statusBarItem: HTMLElement;
  private isIndexing: boolean = false;
  private debounceTimer: NodeJS.Timeout | null = null;

  async onload() {
    console.log('[Smart Links] Loading plugin...');

    // Load settings
    await this.loadSettings();

    // Initialize cache manager
    this.cacheManager = new CacheManager(this.app);

    // Try to load cache from disk
    const loadedCache = await this.cacheManager.loadCache();
    if (loadedCache) {
      this.cache = loadedCache;
      console.log('[Smart Links] Loaded cache with', this.cache.totalDocuments, 'notes');
    } else {
      this.cache = this.cacheManager.createEmptyCache();
      console.log('[Smart Links] Created new cache');
    }

    // Initialize engines
    this.tfidfEngine = new TFIDFEngine(this.cache);
    // this.embeddingEngine = new EmbeddingEngine(this.cache); // Disabled for Phase 2 - will re-enable in Phase 3
    this.hybridScorer = new HybridScorer(
      this.tfidfEngine,
      null, // Embeddings disabled for Phase 2 testing
      this.settings
    );

    this.vaultIndexer = new VaultIndexer(
      this.app,
      this.cache,
      this.settings,
      this.cacheManager
    );

    // Initialize link discovery
    this.linkDiscovery = new LinkDiscovery(
      this.app,
      this.cache,
      this.settings,
      this.hybridScorer
    );

    // Register suggestion panel view
    this.registerView(
      SUGGESTION_PANEL_VIEW_TYPE,
      (leaf) => new SuggestionPanelView(leaf, this)
    );

    // Add ribbon icon
    this.addRibbonIcon('link', 'Smart Links', () => {
      this.toggleSuggestionPanel();
    });

    // Open suggestion panel by default
    await this.activateSuggestionPanel();

    // Register commands
    this.registerCommands();

    // Register event handlers
    this.registerEventHandlers();

    // Add settings tab
    this.addSettingTab(new SmartLinksSettingTab(this.app, this));

    // Add status bar
    this.statusBarItem = this.addStatusBarItem();
    this.updateStatusBar('Ready');

    console.log('[Smart Links] Plugin loaded successfully');
  }

  onunload() {
    console.log('[Smart Links] Unloading plugin...');

    // Cleanup debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    // Detach suggestion panel
    this.app.workspace.detachLeavesOfType(SUGGESTION_PANEL_VIEW_TYPE);
  }

  /**
   * Register all plugin commands
   */
  private registerCommands() {
    // Command: Analyze entire vault
    this.addCommand({
      id: 'analyze-vault',
      name: 'Analyze entire vault',
      callback: async () => {
        if (this.isIndexing) {
          new Notice('Analysis already in progress...');
          return;
        }

        this.isIndexing = true;
        const startTime = Date.now();

        try {
          new Notice('Starting vault analysis...');
          this.updateStatusBar('Analyzing...');

          await this.vaultIndexer.analyzeVault((progress, message) => {
            this.updateStatusBar(`Analyzing: ${Math.round(progress)}%`);
          });

          const duration = ((Date.now() - startTime) / 1000).toFixed(1);
          const stats = this.vaultIndexer.getStatistics();

          new Notice(
            `Analysis complete! Indexed ${stats.totalNotes} notes in ${duration}s`
          );
          this.updateStatusBar('Ready');
        } catch (error) {
          console.error('[Smart Links] Analysis failed:', error);
          new Notice('Analysis failed. Check console for details.');
          this.updateStatusBar('Error');
        } finally {
          this.isIndexing = false;
        }
      }
    });

    // Command: Show vault statistics
    this.addCommand({
      id: 'show-statistics',
      name: 'Show vault statistics',
      callback: () => {
        const stats = this.vaultIndexer.getStatistics();
        const tfidfStats = this.tfidfEngine.getStatistics();

        const message = [
          `Total Notes: ${stats.totalNotes}`,
          `Total Terms: ${stats.totalTerms}`,
          `Total Links: ${stats.totalLinks}`,
          `Avg Keywords per Note: ${stats.avgKeywordsPerNote.toFixed(1)}`,
          `Avg TF-IDF Vector Size: ${tfidfStats.avgVectorSize.toFixed(1)}`,
          `Last Analysis: ${stats.lastAnalysis?.toLocaleString() || 'Never'}`
        ].join('\n');

        new Notice(message, 10000);
        console.log('[Smart Links] Statistics:\n' + message);
      }
    });

    // Command: Clear cache
    this.addCommand({
      id: 'clear-cache',
      name: 'Clear cache and re-analyze',
      callback: async () => {
        try {
          await this.cacheManager.clearCache();
          this.cache = this.cacheManager.createEmptyCache();
          new Notice('Cache cleared. Run "Analyze entire vault" to rebuild.');
          this.updateStatusBar('Cache cleared');
        } catch (error) {
          console.error('[Smart Links] Failed to clear cache:', error);
          new Notice('Failed to clear cache');
        }
      }
    });

    // Command: Update current note
    this.addCommand({
      id: 'update-current-note',
      name: 'Re-index current note',
      callback: async () => {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
          new Notice('No active file');
          return;
        }

        try {
          new Notice('Updating note index...');
          await this.vaultIndexer.updateNote(activeFile);
          new Notice('Note updated successfully');
        } catch (error) {
          console.error('[Smart Links] Failed to update note:', error);
          new Notice('Failed to update note');
        }
      }
    });

    // Command: Find similar notes (Phase 1 basic version)
    this.addCommand({
      id: 'find-similar-notes',
      name: 'Find similar notes to current note',
      callback: async () => {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
          new Notice('No active file');
          return;
        }

        const sourceNote = this.cache.notes.get(activeFile.path);
        if (!sourceNote) {
          new Notice('Current note not indexed. Run "Analyze entire vault" first.');
          return;
        }

        try {
          const similarNotes = this.tfidfEngine.findSimilarNotes(
            sourceNote,
            this.settings.tfidfThreshold,
            this.settings.maxSuggestionsPerNote
          );

          if (similarNotes.length === 0) {
            new Notice('No similar notes found');
            return;
          }

          // Display results
          const message = similarNotes
            .map((result, index) =>
              `${index + 1}. ${result.note.title} (${(result.score * 100).toFixed(1)}%)\n   Keywords: ${result.matchedKeywords.slice(0, 3).join(', ')}`
            )
            .join('\n\n');

          console.log('[Smart Links] Similar notes:\n' + message);
          new Notice(
            `Found ${similarNotes.length} similar notes. Check console for details.`,
            5000
          );
        } catch (error) {
          console.error('[Smart Links] Failed to find similar notes:', error);
          new Notice('Failed to find similar notes');
        }
      }
    });
  }

  /**
   * Register event handlers for file changes and real-time monitoring
   */
  private registerEventHandlers() {
    // Real-time suggestion updates (active file change)
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', async (leaf) => {
        const file = leaf?.view.getViewType() === 'markdown'
          ? this.app.workspace.getActiveFile()
          : null;

        // Trigger analysis for new active file
        if (this.settings.enableRealTimeSuggestions) {
          await this.linkDiscovery.analyzeCurrentNote(file);
        }
      })
    );

    // Real-time suggestion updates (editor change with debounce)
    this.registerEvent(
      this.app.workspace.on('editor-change', () => {
        if (!this.settings.enableRealTimeSuggestions) {
          return;
        }

        // Debounce analysis
        if (this.debounceTimer) {
          clearTimeout(this.debounceTimer);
        }

        this.debounceTimer = setTimeout(async () => {
          const activeFile = this.app.workspace.getActiveFile();
          await this.linkDiscovery.analyzeCurrentNote(activeFile);
        }, this.settings.debounceDelay);
      })
    );

    // Setup suggestion update callback
    this.linkDiscovery.onUpdate((update) => {
      // Update suggestion panel if it exists
      const leaves = this.app.workspace.getLeavesOfType(SUGGESTION_PANEL_VIEW_TYPE);
      if (leaves.length > 0 && leaves[0].view instanceof SuggestionPanelView) {
        leaves[0].view.updateSuggestions(update.suggestions);
      }
    });

    // File modified (update index)
    this.registerEvent(
      this.app.vault.on('modify', async (file) => {
        if (file instanceof TFile && file.extension === 'md') {
          // Update index in background
          await this.vaultIndexer.updateNote(file);
        }
      })
    );

    // File deleted
    this.registerEvent(
      this.app.vault.on('delete', async (file) => {
        if (file instanceof TFile && file.extension === 'md') {
          await this.vaultIndexer.removeNote(file);
        }
      })
    );

    // File renamed
    this.registerEvent(
      this.app.vault.on('rename', async (file, oldPath) => {
        if (file instanceof TFile && file.extension === 'md') {
          await this.vaultIndexer.renameNote(file, oldPath);
        }
      })
    );
  }

  /**
   * Update status bar text
   */
  private updateStatusBar(text: string) {
    this.statusBarItem.setText(`Smart Links: ${text}`);
  }

  /**
   * Toggle suggestion panel visibility
   */
  async toggleSuggestionPanel() {
    const leaves = this.app.workspace.getLeavesOfType(SUGGESTION_PANEL_VIEW_TYPE);

    if (leaves.length > 0) {
      // Panel exists, detach it
      this.app.workspace.detachLeavesOfType(SUGGESTION_PANEL_VIEW_TYPE);
    } else {
      // Panel doesn't exist, activate it
      await this.activateSuggestionPanel();
    }
  }

  /**
   * Activate suggestion panel in right sidebar
   */
  async activateSuggestionPanel() {
    const { workspace } = this.app;

    // Check if panel already exists
    let leaf = workspace.getLeavesOfType(SUGGESTION_PANEL_VIEW_TYPE)[0];

    if (!leaf) {
      // Create new leaf in right sidebar
      const position = this.settings.suggestionPanelPosition;
      const sideLeaf = workspace.getRightLeaf(false);

      if (sideLeaf) {
        leaf = sideLeaf;
        await leaf.setViewState({
          type: SUGGESTION_PANEL_VIEW_TYPE,
          active: true
        });
      }
    }

    // Reveal the leaf
    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  /**
   * Load settings from disk
   */
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  /**
   * Save settings to disk
   */
  async saveSettings() {
    await this.saveData(this.settings);

    // Update components with new settings
    if (this.linkDiscovery) {
      this.linkDiscovery.updateSettings(this.settings);
    }
    if (this.hybridScorer) {
      this.hybridScorer.updateSettings(this.settings);
    }

    // Update suggestion panel if exists
    const leaves = this.app.workspace.getLeavesOfType(SUGGESTION_PANEL_VIEW_TYPE);
    if (leaves.length > 0 && leaves[0].view instanceof SuggestionPanelView) {
      leaves[0].view.updateSettings(this.settings);
    }
  }
}
