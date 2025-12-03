import { App, Plugin, PluginSettingTab, Setting, Notice } from 'obsidian';
import { SmartLinksSettings, EMBEDDING_MODELS, getModelConfig, EmbeddingModelConfig } from './types';

import { BackupManager } from './batch/backup-manager';

// Forward declaration to avoid circular dependency
type SmartLinksPlugin = Plugin & {
  settings: SmartLinksSettings;
  saveSettings: () => Promise<void>;
  enableNeuralEmbeddings?: () => Promise<void>;
  disableNeuralEmbeddings?: () => void;
  regenerateEmbeddings?: () => Promise<void>;
  changeEmbeddingModel?: (modelName: string) => Promise<void>;
  isEmbeddingModelLoaded?: () => boolean;
  getEmbeddingCacheStats?: () => { totalEmbeddings: number; cacheSizeFormatted: string; embeddingDimension?: number } | null;
  getCurrentModelConfig?: () => EmbeddingModelConfig | null;
  // Vault indexing methods
  analyzeVault?: () => Promise<void>;
  clearCache?: () => Promise<void>;
  getIndexStats?: () => { notesIndexed: number; termsIndexed: number; lastAnalysis?: number };
  getIsIndexing?: () => boolean;
  // Batch auto-link methods
  runBatchAutoLink?: () => Promise<void>;
  restoreFromBackup?: () => Promise<void>;
  hasBackupAvailable?: () => Promise<boolean>;
  getBackupManager?: () => BackupManager | null;
};

/**
 * Settings tab for Smart Links plugin
 */
export class SmartLinksSettingTab extends PluginSettingTab {
  plugin: SmartLinksPlugin;

  constructor(app: App, plugin: SmartLinksPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Smart Links Settings' });

    // Vault Index Section (most important - required for everything else)
    this.renderVaultIndexSection(containerEl);

    // Featured: Auto-Link Section
    this.renderAutoLinkSection(containerEl);

    // Analysis Mode Section
    containerEl.createEl('h3', { text: 'Analysis Mode' });

    new Setting(containerEl)
      .setName('Enable real-time suggestions')
      .setDesc('Show link suggestions as you type')
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.enableRealTimeSuggestions)
          .onChange(async (value) => {
            this.plugin.settings.enableRealTimeSuggestions = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Enable semantic search')
      .setDesc('Use N-gram and context-based semantic analysis')
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.enableSemanticSearch)
          .onChange(async (value) => {
            this.plugin.settings.enableSemanticSearch = value;
            await this.plugin.saveSettings();
          })
      );

    // Neural Embeddings Section
    containerEl.createEl('h3', { text: 'Neural Embeddings (Advanced)' });

    const embeddingDesc = containerEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'Neural embeddings provide the most accurate semantic understanding using AI. Requires downloading a model (size varies by choice). All processing happens locally.'
    });
    embeddingDesc.style.marginBottom = '12px';

    // Status display
    const statusEl = containerEl.createDiv({ cls: 'smart-links-embedding-status' });
    this.updateEmbeddingStatus(statusEl);

    new Setting(containerEl)
      .setName('Enable neural embeddings')
      .setDesc('Use transformer-based embeddings for highest accuracy semantic matching')
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.enableNeuralEmbeddings)
          .onChange(async (value) => {
            if (value) {
              // Enable embeddings - this will trigger model download
              if (this.plugin.enableNeuralEmbeddings) {
                try {
                  await this.plugin.enableNeuralEmbeddings();
                  this.plugin.settings.enableNeuralEmbeddings = true;
                  await this.plugin.saveSettings();
                  this.updateEmbeddingStatus(statusEl);
                } catch (error) {
                  console.error('[Settings] Failed to enable neural embeddings:', error);
                  toggle.setValue(false);
                  new Notice('Failed to enable neural embeddings. Check console for details.');
                }
              } else {
                this.plugin.settings.enableNeuralEmbeddings = true;
                await this.plugin.saveSettings();
              }
            } else {
              // Disable embeddings
              if (this.plugin.disableNeuralEmbeddings) {
                this.plugin.disableNeuralEmbeddings();
              }
              this.plugin.settings.enableNeuralEmbeddings = false;
              await this.plugin.saveSettings();
              this.updateEmbeddingStatus(statusEl);
            }
          })
      );

    // Model selection dropdown
    const modelInfoEl = containerEl.createDiv({ cls: 'smart-links-model-info' });
    this.updateModelInfo(modelInfoEl, this.plugin.settings.neuralModelName);

    new Setting(containerEl)
      .setName('Embedding model')
      .setDesc('Choose the model for generating embeddings. Larger models are more accurate but slower.')
      .addDropdown(dropdown => {
        // Add all available models
        for (const model of EMBEDDING_MODELS) {
          dropdown.addOption(model.name, `${model.displayName} (${model.size})`);
        }
        dropdown.setValue(this.plugin.settings.neuralModelName);
        dropdown.onChange(async (value) => {
          const currentModel = this.plugin.settings.neuralModelName;
          if (value !== currentModel) {
            // Warn user that changing models will clear the cache
            const confirmed = confirm(
              `Changing models will clear your existing embeddings cache.\n\n` +
              `You will need to regenerate embeddings for all notes.\n\n` +
              `Continue?`
            );

            if (confirmed) {
              // Update model info display
              this.updateModelInfo(modelInfoEl, value);

              if (this.plugin.changeEmbeddingModel) {
                try {
                  await this.plugin.changeEmbeddingModel(value);
                  this.updateEmbeddingStatus(statusEl);
                  new Notice('Model changed. Regenerating embeddings...');
                } catch (error) {
                  console.error('[Settings] Failed to change model:', error);
                  dropdown.setValue(currentModel);
                  new Notice('Failed to change model. Check console for details.');
                }
              } else {
                // Just save the setting if plugin method not available
                this.plugin.settings.neuralModelName = value;
                await this.plugin.saveSettings();
              }
            } else {
              // Revert selection
              dropdown.setValue(currentModel);
            }
          }
        });
      });

    new Setting(containerEl)
      .setName('Regenerate embeddings')
      .setDesc('Re-process all notes to generate fresh embeddings')
      .addButton(button =>
        button
          .setButtonText('Regenerate')
          .setDisabled(!this.plugin.settings.enableNeuralEmbeddings)
          .onClick(async () => {
            if (this.plugin.regenerateEmbeddings) {
              button.setDisabled(true);
              button.setButtonText('Processing...');
              try {
                await this.plugin.regenerateEmbeddings();
                this.updateEmbeddingStatus(statusEl);
                new Notice('Embeddings regenerated successfully!');
              } catch (error) {
                console.error('[Settings] Failed to regenerate embeddings:', error);
                new Notice('Failed to regenerate embeddings. Check console for details.');
              } finally {
                button.setDisabled(false);
                button.setButtonText('Regenerate');
              }
            } else {
              new Notice('Regenerate function not available');
            }
          })
      );

    new Setting(containerEl)
      .setName('Embedding batch size')
      .setDesc('Number of notes to process at once (lower = less memory)')
      .addText(text =>
        text
          .setPlaceholder('8')
          .setValue(String(this.plugin.settings.embeddingBatchSize))
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num > 0 && num <= 32) {
              this.plugin.settings.embeddingBatchSize = num;
              await this.plugin.saveSettings();
            }
          })
      );

    // Threshold Section
    containerEl.createEl('h3', { text: 'Thresholds' });

    new Setting(containerEl)
      .setName('TF-IDF threshold')
      .setDesc('Minimum similarity score for keyword-based matching (0.0-1.0)')
      .addSlider(slider =>
        slider
          .setLimits(0, 1, 0.05)
          .setValue(this.plugin.settings.tfidfThreshold)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.tfidfThreshold = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Semantic threshold')
      .setDesc('Minimum similarity score for semantic matching (0.0-1.0)')
      .addSlider(slider =>
        slider
          .setLimits(0, 1, 0.05)
          .setValue(this.plugin.settings.semanticThreshold)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.semanticThreshold = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Combined threshold')
      .setDesc('Minimum score for hybrid suggestions (0.0-1.0)')
      .addSlider(slider =>
        slider
          .setLimits(0, 1, 0.05)
          .setValue(this.plugin.settings.combinedThreshold)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.combinedThreshold = value;
            await this.plugin.saveSettings();
          })
      );

    // Weights Section
    containerEl.createEl('h3', { text: 'Hybrid Scoring Weights' });

    new Setting(containerEl)
      .setName('TF-IDF weight')
      .setDesc('Weight for keyword-based scoring (0.0-1.0)')
      .addSlider(slider =>
        slider
          .setLimits(0, 1, 0.1)
          .setValue(this.plugin.settings.tfidfWeight)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.tfidfWeight = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Semantic weight')
      .setDesc('Weight for semantic scoring (0.0-1.0)')
      .addSlider(slider =>
        slider
          .setLimits(0, 1, 0.1)
          .setValue(this.plugin.settings.semanticWeight)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.semanticWeight = value;
            await this.plugin.saveSettings();
          })
      );

    // Performance Section
    containerEl.createEl('h3', { text: 'Performance' });

    new Setting(containerEl)
      .setName('Max suggestions per note')
      .setDesc('Maximum number of suggestions to generate for each note')
      .addText(text =>
        text
          .setPlaceholder('10')
          .setValue(String(this.plugin.settings.maxSuggestionsPerNote))
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num > 0) {
              this.plugin.settings.maxSuggestionsPerNote = num;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName('Batch size')
      .setDesc('Number of notes to process in each batch during vault analysis')
      .addText(text =>
        text
          .setPlaceholder('50')
          .setValue(String(this.plugin.settings.batchSize))
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num > 0) {
              this.plugin.settings.batchSize = num;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName('Enable caching')
      .setDesc('Cache analysis results for faster performance')
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.cacheEnabled)
          .onChange(async (value) => {
            this.plugin.settings.cacheEnabled = value;
            await this.plugin.saveSettings();
          })
      );

    // Exclusions Section
    containerEl.createEl('h3', { text: 'Exclusions' });

    new Setting(containerEl)
      .setName('Excluded folders')
      .setDesc('Comma-separated list of folder paths to exclude (e.g., Templates, Archive)')
      .addText(text =>
        text
          .setPlaceholder('Templates, Archive')
          .setValue(this.plugin.settings.excludedFolders.join(', '))
          .onChange(async (value) => {
            this.plugin.settings.excludedFolders = value
              .split(',')
              .map(s => s.trim())
              .filter(s => s.length > 0);
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Excluded tags')
      .setDesc('Comma-separated list of tags to exclude (e.g., #draft, #private)')
      .addText(text =>
        text
          .setPlaceholder('#draft, #private')
          .setValue(this.plugin.settings.excludedTags.join(', '))
          .onChange(async (value) => {
            this.plugin.settings.excludedTags = value
              .split(',')
              .map(s => s.trim())
              .filter(s => s.length > 0);
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Minimum note length')
      .setDesc('Ignore notes shorter than this many characters')
      .addText(text =>
        text
          .setPlaceholder('50')
          .setValue(String(this.plugin.settings.minNoteLength))
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num >= 0) {
              this.plugin.settings.minNoteLength = num;
              await this.plugin.saveSettings();
            }
          })
      );

    // Features Section
    containerEl.createEl('h3', { text: 'Features' });

    new Setting(containerEl)
      .setName('Show confidence scores')
      .setDesc('Display similarity scores with suggestions')
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.showConfidenceScores)
          .onChange(async (value) => {
            this.plugin.settings.showConfidenceScores = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Analysis debounce delay')
      .setDesc('Milliseconds to wait after typing before analyzing (default: 300ms)')
      .addText(text =>
        text
          .setValue(String(this.plugin.settings.debounceDelay))
          .onChange(async (value) => {
            const delay = parseInt(value);
            if (!isNaN(delay) && delay >= 100 && delay <= 2000) {
              this.plugin.settings.debounceDelay = delay;
              await this.plugin.saveSettings();
            }
          })
      );

    // UI Section
    containerEl.createEl('h3', { text: 'User Interface' });

    new Setting(containerEl)
      .setName('Suggestion panel position')
      .setDesc('Where to display the suggestion panel')
      .addDropdown(dropdown =>
        dropdown
          .addOption('left', 'Left sidebar')
          .addOption('right', 'Right sidebar')
          .setValue(this.plugin.settings.suggestionPanelPosition)
          .onChange(async (value: 'left' | 'right') => {
            this.plugin.settings.suggestionPanelPosition = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Max real-time suggestions')
      .setDesc('Maximum number of suggestions to show in real-time panel')
      .addText(text =>
        text
          .setPlaceholder('5')
          .setValue(String(this.plugin.settings.maxRealtimeSuggestions))
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num > 0) {
              this.plugin.settings.maxRealtimeSuggestions = num;
              await this.plugin.saveSettings();
            }
          })
      );
  }

  /**
   * Update the embedding status display
   */
  private updateEmbeddingStatus(statusEl: HTMLElement): void {
    statusEl.empty();

    if (!this.plugin.settings.enableNeuralEmbeddings) {
      statusEl.createEl('span', {
        text: 'Status: Disabled',
        cls: 'smart-links-status-disabled'
      });
      return;
    }

    const isLoaded = this.plugin.isEmbeddingModelLoaded?.() || false;
    const stats = this.plugin.getEmbeddingCacheStats?.();

    if (!isLoaded) {
      statusEl.createEl('span', {
        text: 'Status: Model not loaded',
        cls: 'smart-links-status-warning'
      });
      return;
    }

    statusEl.createEl('span', {
      text: 'Status: Ready',
      cls: 'smart-links-status-ready'
    });

    if (stats) {
      statusEl.createEl('span', {
        text: ` | ${stats.totalEmbeddings} embeddings (${stats.cacheSizeFormatted})`,
        cls: 'smart-links-status-info'
      });
    }
  }

  /**
   * Update the model info display
   */
  private updateModelInfo(infoEl: HTMLElement, modelName: string): void {
    infoEl.empty();

    const modelConfig = getModelConfig(modelName);
    if (!modelConfig) {
      return;
    }

    // Create info container
    infoEl.addClass('smart-links-model-info');
    infoEl.style.marginBottom = '12px';
    infoEl.style.padding = '8px 12px';
    infoEl.style.backgroundColor = 'var(--background-secondary)';
    infoEl.style.borderRadius = '4px';
    infoEl.style.fontSize = '12px';

    // Model description
    const descEl = infoEl.createEl('div', {
      text: modelConfig.description,
      cls: 'smart-links-model-desc'
    });
    descEl.style.marginBottom = '4px';

    // Model stats
    const statsEl = infoEl.createEl('div', {
      cls: 'smart-links-model-stats'
    });
    statsEl.style.color = 'var(--text-muted)';

    // Quality badge
    const qualityColors: Record<string, string> = {
      'good': 'var(--text-success)',
      'better': 'var(--text-accent)',
      'best': 'var(--color-purple)'
    };
    const qualityBadge = statsEl.createEl('span', {
      text: modelConfig.quality.toUpperCase()
    });
    qualityBadge.style.color = qualityColors[modelConfig.quality] || 'var(--text-normal)';
    qualityBadge.style.fontWeight = 'bold';
    qualityBadge.style.marginRight = '8px';

    // Speed and dimension info
    statsEl.createEl('span', {
      text: `Speed: ${modelConfig.speed} | Dimensions: ${modelConfig.dimension} | Size: ${modelConfig.size}`
    });
  }

  /**
   * Render the Vault Index section - required for all other features
   */
  private renderVaultIndexSection(containerEl: HTMLElement): void {
    // Featured container
    const sectionEl = containerEl.createDiv('smart-links-vault-index-section');

    // Header
    sectionEl.createEl('h3', { text: 'Vault Index' });
    sectionEl.createEl('p', {
      text: 'Index your vault to enable link suggestions. This is required before using any other features.',
      cls: 'smart-links-section-desc'
    });

    // Status display
    const statusEl = sectionEl.createDiv('smart-links-index-status');
    this.updateIndexStatus(statusEl);

    // Button container
    const buttonContainer = sectionEl.createDiv('smart-links-index-buttons');

    // Analyze Vault button
    const analyzeButton = buttonContainer.createEl('button', {
      text: 'Analyze Vault',
      cls: 'mod-cta smart-links-analyze-button'
    });

    // Check if currently indexing
    if (this.plugin.getIsIndexing?.()) {
      analyzeButton.addClass('smart-links-button-disabled');
      analyzeButton.setAttribute('disabled', 'true');
      analyzeButton.setText('Analyzing...');
    }

    // Use onclick instead of addEventListener to prevent memory leaks on tab reopen
    analyzeButton.onclick = async () => {
      if (this.plugin.getIsIndexing?.()) {
        new Notice('Analysis already in progress...');
        return;
      }
      if (this.plugin.analyzeVault) {
        analyzeButton.addClass('smart-links-button-disabled');
        analyzeButton.setAttribute('disabled', 'true');
        analyzeButton.setText('Analyzing...');
        try {
          await this.plugin.analyzeVault();
          // Refresh the display after analysis
          this.display();
        } catch (error) {
          console.error('[Settings] Failed to analyze vault:', error);
          new Notice(`Analysis failed: ${(error as Error).message}`);
          analyzeButton.removeClass('smart-links-button-disabled');
          analyzeButton.removeAttribute('disabled');
          analyzeButton.setText('Analyze Vault');
        }
      } else {
        new Notice('Vault analysis not available');
      }
    };

    // Clear Cache button
    const clearButton = buttonContainer.createEl('button', {
      text: 'Clear Cache',
      cls: 'smart-links-clear-cache-button'
    });
    clearButton.onclick = async () => {
      const confirmed = confirm(
        'This will delete all indexed data. You will need to re-analyze the vault. Continue?'
      );
      if (confirmed && this.plugin.clearCache) {
        try {
          await this.plugin.clearCache();
          new Notice('Cache cleared. Click "Analyze Vault" to rebuild.');
          this.display();
        } catch (error) {
          console.error('[Settings] Failed to clear cache:', error);
          new Notice(`Clear cache failed: ${(error as Error).message}`);
        }
      }
    };

    // Separator
    containerEl.createEl('hr', { cls: 'smart-links-separator' });
  }

  /**
   * Update the index status display
   */
  private updateIndexStatus(statusEl: HTMLElement): void {
    statusEl.empty();

    const stats = this.plugin.getIndexStats?.();

    if (!stats || stats.notesIndexed === 0) {
      const warningEl = statusEl.createDiv('smart-links-index-warning');
      warningEl.createSpan({ text: '⚠️ ' });
      warningEl.createSpan({
        text: 'Vault not indexed. Click "Analyze Vault" to enable features.',
        cls: 'smart-links-warning-text'
      });
    } else {
      const infoEl = statusEl.createDiv('smart-links-index-info');
      infoEl.createSpan({
        text: `✓ ${stats.notesIndexed} notes indexed`,
        cls: 'smart-links-success-text'
      });
      infoEl.createSpan({ text: ' | ' });
      infoEl.createSpan({
        text: `${stats.termsIndexed.toLocaleString()} unique terms`,
        cls: 'smart-links-muted'
      });

      if (stats.lastAnalysis) {
        const date = new Date(stats.lastAnalysis);
        const formatted = date.toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
        infoEl.createSpan({ text: ' | ' });
        infoEl.createSpan({
          text: `Last: ${formatted}`,
          cls: 'smart-links-muted'
        });
      }
    }
  }

  /**
   * Render the featured Auto-Link section at the top of settings
   */
  private async renderAutoLinkSection(containerEl: HTMLElement): Promise<void> {
    // Featured container
    const featureEl = containerEl.createDiv('smart-links-autolink-feature');

    // Header with icon
    const headerEl = featureEl.createDiv('smart-links-autolink-header');
    headerEl.createEl('h3', { text: 'Auto-Link Your Vault' });
    headerEl.createEl('p', {
      text: 'Automatically find and create links across all your notes',
      cls: 'smart-links-autolink-desc'
    });

    // Main action button
    const buttonContainer = featureEl.createDiv('smart-links-autolink-buttons');

    const mainButton = buttonContainer.createEl('button', {
      text: 'Link My Vault',
      cls: 'mod-cta smart-links-autolink-button'
    });
    mainButton.onclick = async () => {
      if (this.plugin.runBatchAutoLink) {
        await this.plugin.runBatchAutoLink();
        // Refresh the display after batch linking
        this.display();
      } else {
        new Notice('Batch auto-link not available');
      }
    };

    // Status info
    const statusEl = featureEl.createDiv('smart-links-autolink-status');
    this.updateAutoLinkStatus(statusEl);

    // Restore button (if backup available)
    this.renderRestoreButton(buttonContainer);

    // Settings section
    const settingsEl = featureEl.createDiv('smart-links-autolink-settings');
    settingsEl.createEl('h4', { text: 'Options' });

    // Preview mode toggle
    new Setting(settingsEl)
      .setName('Preview before applying')
      .setDesc('Show what will be linked before making changes')
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.batchLinkSettings.enablePreviewMode)
          .onChange(async (value) => {
            this.plugin.settings.batchLinkSettings.enablePreviewMode = value;
            await this.plugin.saveSettings();
          })
      );

    // Confidence threshold
    new Setting(settingsEl)
      .setName('Confidence threshold')
      .setDesc('Minimum similarity score to create a link (0.1 = more links, 0.5 = fewer but higher quality)')
      .addSlider(slider =>
        slider
          .setLimits(0.1, 0.7, 0.05)
          .setValue(this.plugin.settings.batchLinkSettings.confidenceThreshold)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.batchLinkSettings.confidenceThreshold = value;
            await this.plugin.saveSettings();
          })
      );

    // Max links per note
    new Setting(settingsEl)
      .setName('Maximum links per note')
      .setDesc('Limit how many links to add to each note')
      .addText(text =>
        text
          .setValue(String(this.plugin.settings.batchLinkSettings.maxLinksPerNote))
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num > 0 && num <= 50) {
              this.plugin.settings.batchLinkSettings.maxLinksPerNote = num;
              await this.plugin.saveSettings();
            }
          })
      );

    // Smart Matching Section
    settingsEl.createEl('h4', { text: 'Smart Matching', cls: 'smart-links-subheading' });

    // Exact title match only
    new Setting(settingsEl)
      .setName('Exact title match only')
      .setDesc('Only create links when the exact note title is found in text (recommended). Disabling allows partial matches but may create incorrect links.')
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.batchLinkSettings.exactTitleMatchOnly ?? true)
          .onChange(async (value) => {
            this.plugin.settings.batchLinkSettings.exactTitleMatchOnly = value;
            await this.plugin.saveSettings();
          })
      );

    // Context verification
    new Setting(settingsEl)
      .setName('Context verification')
      .setDesc('Use neural embeddings to verify that the surrounding text is related to the target note. Requires neural embeddings to be enabled.')
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.batchLinkSettings.enableContextVerification ?? true)
          .onChange(async (value) => {
            this.plugin.settings.batchLinkSettings.enableContextVerification = value;
            await this.plugin.saveSettings();
          })
      );

    // Max document frequency
    new Setting(settingsEl)
      .setName('Word uniqueness threshold')
      .setDesc('Skip words that appear in more than X% of notes (they\'re too common to be meaningful links)')
      .addSlider(slider =>
        slider
          .setLimits(5, 50, 5)
          .setValue(this.plugin.settings.batchLinkSettings.maxDocFrequencyPercent ?? 20)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.batchLinkSettings.maxDocFrequencyPercent = value;
            await this.plugin.saveSettings();
          })
      );

    // Backup & Restore History Section
    await this.renderBackupHistorySection(settingsEl);

    // Separator
    containerEl.createEl('hr', { cls: 'smart-links-separator' });
  }

  /**
   * Update the auto-link status display
   */
  private updateAutoLinkStatus(statusEl: HTMLElement): void {
    statusEl.empty();

    const lastRun = this.plugin.settings.batchLinkSettings.lastRunTimestamp;
    if (lastRun) {
      const date = new Date(lastRun);
      const formatted = date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      statusEl.createEl('span', {
        text: `Last run: ${formatted}`,
        cls: 'smart-links-autolink-lastrun'
      });
    } else {
      statusEl.createEl('span', {
        text: 'Never run',
        cls: 'smart-links-autolink-lastrun smart-links-muted'
      });
    }
  }

  /**
   * Render the restore button if backup is available
   */
  private async renderRestoreButton(container: HTMLElement): Promise<void> {
    const hasBackup = await this.plugin.hasBackupAvailable?.() || false;

    const restoreButton = container.createEl('button', {
      text: 'Restore from Backup',
      cls: 'smart-links-restore-button'
    });

    if (!hasBackup) {
      restoreButton.addClass('smart-links-button-disabled');
      restoreButton.setAttribute('disabled', 'true');
      restoreButton.setAttribute('title', 'No backup available');
    } else {
      restoreButton.onclick = async () => {
        const confirmed = confirm(
          'This will restore your notes to their state before the last batch auto-link. Continue?'
        );
        if (confirmed && this.plugin.restoreFromBackup) {
          await this.plugin.restoreFromBackup();
          new Notice('Notes restored from backup');
          this.display();
        }
      };
    }
  }

  /**
   * Render backup & restore history section
   */
  private async renderBackupHistorySection(containerEl: HTMLElement): Promise<void> {
    const sectionEl = containerEl.createDiv('smart-links-backup-history-section');
    sectionEl.createEl('h4', { text: 'Backup & Restore History', cls: 'smart-links-subheading' });

    // Get backup manager stats
    const backupManager = this.plugin.getBackupManager?.();
    if (!backupManager) {
      sectionEl.createEl('p', {
        text: 'Backup manager not available',
        cls: 'smart-links-muted'
      });
      return;
    }

    // Stats summary
    const stats = await backupManager.getStats();
    const statsEl = sectionEl.createDiv('smart-links-backup-stats');

    const statsGrid = statsEl.createDiv('smart-links-stats-grid');

    // Backups stat
    const backupStat = statsGrid.createDiv('smart-links-stat-item');
    backupStat.createEl('span', { text: String(stats.totalBackups), cls: 'smart-links-stat-value' });
    backupStat.createEl('span', { text: 'Backups', cls: 'smart-links-stat-label' });

    // Restores stat
    const restoreStat = statsGrid.createDiv('smart-links-stat-item');
    restoreStat.createEl('span', { text: String(stats.totalRestores), cls: 'smart-links-stat-value' });
    restoreStat.createEl('span', { text: 'Restores', cls: 'smart-links-stat-label' });

    // Total links stat
    const linksStat = statsGrid.createDiv('smart-links-stat-item');
    linksStat.createEl('span', { text: String(stats.totalLinksAdded), cls: 'smart-links-stat-value' });
    linksStat.createEl('span', { text: 'Links Added', cls: 'smart-links-stat-label' });

    // Last backup info
    if (stats.lastBackupTimestamp) {
      const lastBackupEl = sectionEl.createDiv('smart-links-last-activity');
      const backupDate = new Date(stats.lastBackupTimestamp);
      lastBackupEl.createEl('span', {
        text: `Last backup: ${backupDate.toLocaleString()}`,
        cls: 'smart-links-activity-item'
      });
    }

    // Last restore info
    if (stats.lastRestoreTimestamp) {
      const lastRestoreEl = sectionEl.createDiv('smart-links-last-activity');
      const restoreDate = new Date(stats.lastRestoreTimestamp);
      lastRestoreEl.createEl('span', {
        text: `Last restore: ${restoreDate.toLocaleString()}`,
        cls: 'smart-links-activity-item'
      });
    }

    // Available backups list
    const backups = await backupManager.getAvailableBackups();
    if (backups.length > 0) {
      const listHeader = sectionEl.createDiv('smart-links-backup-list-header');
      listHeader.createEl('h5', { text: 'Available Backups' });

      const listEl = sectionEl.createDiv('smart-links-backup-list');

      for (const backup of backups) {
        if (!backup.hasData) continue;

        const itemEl = listEl.createDiv('smart-links-backup-item');
        const manifest = backup.manifest;

        // Date and description
        const infoEl = itemEl.createDiv('smart-links-backup-info');
        const date = new Date(manifest.timestamp);
        infoEl.createEl('span', {
          text: date.toLocaleString(),
          cls: 'smart-links-backup-date'
        });

        const detailsEl = infoEl.createDiv('smart-links-backup-details');
        detailsEl.createEl('span', {
          text: `${manifest.noteCount} notes • ${manifest.linksAdded} links`,
          cls: 'smart-links-backup-meta'
        });

        if (manifest.description) {
          detailsEl.createEl('span', {
            text: manifest.description,
            cls: 'smart-links-backup-desc smart-links-muted'
          });
        }

        // Restore button for this backup
        const actionsEl = itemEl.createDiv('smart-links-backup-actions');
        const restoreBtn = actionsEl.createEl('button', {
          text: 'Restore',
          cls: 'smart-links-backup-restore-btn'
        });

        restoreBtn.onclick = async () => {
          const confirmed = confirm(
            `Restore ${manifest.noteCount} notes to their state before ${manifest.linksAdded} links were added?`
          );
          if (confirmed) {
            try {
              await backupManager.restoreBackup(manifest.id);
              new Notice(`Restored ${manifest.noteCount} notes from backup`);
              this.display(); // Refresh the view
            } catch (error) {
              new Notice(`Restore failed: ${(error as Error).message}`);
            }
          }
        };
      }
    } else {
      sectionEl.createEl('p', {
        text: 'No backups available yet. Backups are created automatically when you run batch auto-link.',
        cls: 'smart-links-muted'
      });
    }

    // Restore history
    const restoreHistory = await backupManager.getRestoreHistory();
    if (restoreHistory.length > 0) {
      const historyHeader = sectionEl.createDiv('smart-links-restore-history-header');
      historyHeader.createEl('h5', { text: 'Recent Restores' });

      const historyEl = sectionEl.createDiv('smart-links-restore-history');

      // Show only last 5 restores
      for (const record of restoreHistory.slice(0, 5)) {
        const itemEl = historyEl.createDiv('smart-links-restore-item');
        const date = new Date(record.timestamp);

        itemEl.createEl('span', {
          text: date.toLocaleString(),
          cls: 'smart-links-restore-date'
        });

        const detailsEl = itemEl.createDiv('smart-links-restore-details');
        detailsEl.createEl('span', {
          text: `${record.notesRestored}/${record.notesAttempted} notes restored`,
          cls: 'smart-links-restore-meta'
        });

        if (record.duration) {
          detailsEl.createEl('span', {
            text: `(${(record.duration / 1000).toFixed(1)}s)`,
            cls: 'smart-links-muted'
          });
        }

        if (record.errors.length > 0) {
          detailsEl.createEl('span', {
            text: `${record.errors.length} errors`,
            cls: 'smart-links-restore-errors'
          });
        }
      }
    }
  }
}
