import { App, Notice, Plugin, TFile, WorkspaceLeaf } from 'obsidian';
import { SmartLinksSettings, DEFAULT_SETTINGS, VaultCache } from './src/types';
import { SmartLinksSettingTab } from './src/settings';
import { VaultIndexer } from './src/indexing/vault-indexer';
import { CacheManager } from './src/cache/cache-manager';
import { TFIDFEngine } from './src/engines/tfidf-engine';
import { SemanticEngine } from './src/engines/semantic-engine';
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
  private semanticEngine: SemanticEngine | null = null;
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
    console.log('[Smart Links] Loading settings...');
    await this.loadSettings();
    console.log('[Smart Links] Settings loaded:', {
      enableRealTimeSuggestions: this.settings.enableRealTimeSuggestions,
      maxSuggestionsPerNote: this.settings.maxSuggestionsPerNote,
      debounceDelay: this.settings.debounceDelay,
      tfidfThreshold: this.settings.tfidfThreshold
    });

    // Initialize cache manager
    console.log('[Smart Links] Initializing cache manager...');
    this.cacheManager = new CacheManager(this.app);

    // Try to load cache from disk
    console.log('[Smart Links] Loading cache from disk...');
    const loadedCache = await this.cacheManager.loadCache();
    if (loadedCache) {
      this.cache = loadedCache;
      console.log('[Smart Links] ✓ Cache loaded:', this.cache.totalDocuments, 'notes,', this.cache.documentFrequency.size, 'unique terms');

      // Warn if cache has notes but no document frequency data
      if (this.cache.documentFrequency.size === 0 && this.cache.notes.size > 0) {
        console.warn('[Smart Links] ⚠️  Cache has notes but no term frequencies!');
        console.warn('[Smart Links] ⚠️  Suggestions will not work until you run "Analyze entire vault"');
        new Notice('Smart Links: Please run "Analyze entire vault" to enable suggestions', 10000);
      }
    } else {
      this.cache = this.cacheManager.createEmptyCache();
      console.log('[Smart Links] ✓ New cache created (no existing cache found)');
    }

    // Initialize engines
    console.log('[Smart Links] Initializing TF-IDF engine...');
    this.tfidfEngine = new TFIDFEngine(this.cache);
    console.log('[Smart Links] ✓ TF-IDF engine initialized');

    // Initialize semantic engine
    console.log('[Smart Links] Initializing semantic engine...');
    this.semanticEngine = new SemanticEngine(this.cache);
    console.log('[Smart Links] ✓ Semantic engine initialized');

    console.log('[Smart Links] Initializing hybrid scorer...');
    this.hybridScorer = new HybridScorer(
      this.tfidfEngine,
      this.semanticEngine, // Semantic engine (will build models during vault analysis)
      this.settings
    );
    console.log('[Smart Links] ✓ Hybrid scorer initialized');

    console.log('[Smart Links] Initializing vault indexer...');
    this.vaultIndexer = new VaultIndexer(
      this.app,
      this.cache,
      this.settings,
      this.cacheManager
    );
    console.log('[Smart Links] ✓ Vault indexer initialized');

    // Initialize link discovery
    console.log('[Smart Links] Initializing link discovery engine...');
    this.linkDiscovery = new LinkDiscovery(
      this.app,
      this.cache,
      this.settings,
      this.hybridScorer
    );
    console.log('[Smart Links] ✓ Link discovery initialized');

    // Register suggestion panel view
    console.log('[Smart Links] Registering suggestion panel view...');
    this.registerView(
      SUGGESTION_PANEL_VIEW_TYPE,
      (leaf) => new SuggestionPanelView(leaf, this)
    );
    console.log('[Smart Links] ✓ Panel view registered');

    // Add ribbon icon
    console.log('[Smart Links] Adding ribbon icon...');
    this.addRibbonIcon('link', 'Smart Links', () => {
      console.log('[Smart Links] Ribbon icon clicked');
      this.toggleSuggestionPanel();
    });
    console.log('[Smart Links] ✓ Ribbon icon added');

    // Open suggestion panel after workspace is ready
    console.log('[Smart Links] Waiting for workspace to be ready...');
    this.app.workspace.onLayoutReady(() => {
      console.log('[Smart Links] ✓ Workspace is ready');
      this.activateSuggestionPanel();
    });

    // Register commands
    console.log('[Smart Links] Registering commands...');
    this.registerCommands();
    console.log('[Smart Links] ✓ Commands registered');

    // Register event handlers
    console.log('[Smart Links] Registering event handlers...');
    this.registerEventHandlers();
    console.log('[Smart Links] ✓ Event handlers registered');

    // Add settings tab
    console.log('[Smart Links] Adding settings tab...');
    this.addSettingTab(new SmartLinksSettingTab(this.app, this));
    console.log('[Smart Links] ✓ Settings tab added');

    // Add status bar
    console.log('[Smart Links] Adding status bar...');
    this.statusBarItem = this.addStatusBarItem();
    this.updateStatusBar('Ready');
    console.log('[Smart Links] ✓ Status bar added');

    console.log('[Smart Links] ========================================');
    console.log('[Smart Links] ✓✓✓ Plugin loaded successfully ✓✓✓');
    console.log('[Smart Links] ========================================');
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

          // Step 1: Index vault with TF-IDF
          await this.vaultIndexer.analyzeVault((progress, message) => {
            this.updateStatusBar(`Analyzing: ${Math.round(progress * 0.6)}%`);
          });

          // Step 2: Build semantic models (if enabled)
          if (this.settings.enableSemanticSearch && this.semanticEngine) {
            this.updateStatusBar('Building semantic models...');
            await this.semanticEngine.buildModels((progress, message) => {
              const totalProgress = 60 + (progress * 0.4);
              this.updateStatusBar(`${message}: ${Math.round(totalProgress)}%`);
            });
            this.cache.semanticEnabled = true;
          }

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
    console.log('[Smart Links] Registering active-leaf-change handler...');
    // Real-time suggestion updates (active file change)
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', async (leaf) => {
        const file = leaf?.view.getViewType() === 'markdown'
          ? this.app.workspace.getActiveFile()
          : null;

        console.log('[Smart Links] Active leaf changed, file:', file?.path || 'none');

        // Only analyze when switching TO a markdown note, not when losing focus
        // This prevents clearing suggestions when clicking sidebar buttons
        if (this.settings.enableRealTimeSuggestions && file !== null) {
          console.log('[Smart Links] Triggering real-time analysis for active file...');
          await this.linkDiscovery.analyzeCurrentNote(file);
        } else if (!this.settings.enableRealTimeSuggestions) {
          console.log('[Smart Links] Real-time suggestions disabled, skipping analysis');
        }
      })
    );

    console.log('[Smart Links] Registering editor-change handler...');
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

        console.log('[Smart Links] Editor changed, debouncing analysis (' + this.settings.debounceDelay + 'ms)...');
        this.debounceTimer = setTimeout(async () => {
          const activeFile = this.app.workspace.getActiveFile();
          console.log('[Smart Links] Debounce complete, analyzing:', activeFile?.path);
          await this.linkDiscovery.analyzeCurrentNote(activeFile);
        }, this.settings.debounceDelay);
      })
    );

    console.log('[Smart Links] Setting up suggestion update callback...');
    // Setup suggestion update callback
    this.linkDiscovery.onUpdate((update) => {
      console.log('[Smart Links] Received suggestion update:', update.suggestions.length, 'suggestions');
      // Update suggestion panel if it exists
      const leaves = this.app.workspace.getLeavesOfType(SUGGESTION_PANEL_VIEW_TYPE);
      if (leaves.length > 0 && leaves[0].view instanceof SuggestionPanelView) {
        console.log('[Smart Links] Updating suggestion panel...');
        leaves[0].view.updateSuggestions(update.suggestions);
      } else {
        console.log('[Smart Links] No suggestion panel found to update');
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
    console.log('[Smart Links] Activating suggestion panel...');
    const { workspace } = this.app;

    // Check if panel already exists
    let leaf = workspace.getLeavesOfType(SUGGESTION_PANEL_VIEW_TYPE)[0];
    console.log('[Smart Links] Existing panel leaf:', leaf ? 'found' : 'not found');

    if (!leaf) {
      // Create new leaf in right sidebar
      const position = this.settings.suggestionPanelPosition;
      console.log('[Smart Links] Creating new panel in position:', position);
      const sideLeaf = workspace.getRightLeaf(false);
      console.log('[Smart Links] Right sidebar leaf:', sideLeaf ? 'found' : 'not found');

      if (sideLeaf) {
        leaf = sideLeaf;
        await leaf.setViewState({
          type: SUGGESTION_PANEL_VIEW_TYPE,
          active: true
        });
        console.log('[Smart Links] Panel view state set');
      } else {
        console.error('[Smart Links] Could not get right sidebar leaf');
      }
    }

    // Reveal the leaf
    if (leaf) {
      workspace.revealLeaf(leaf);
      console.log('[Smart Links] Panel revealed');
    } else {
      console.error('[Smart Links] No leaf to reveal');
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
