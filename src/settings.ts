import { App, Plugin, PluginSettingTab, Setting, Notice } from 'obsidian';
import { SmartLinksSettings } from './types';

// Forward declaration to avoid circular dependency
type SmartLinksPlugin = Plugin & {
  settings: SmartLinksSettings;
  saveSettings: () => Promise<void>;
  enableNeuralEmbeddings?: () => Promise<void>;
  disableNeuralEmbeddings?: () => void;
  regenerateEmbeddings?: () => Promise<void>;
  isEmbeddingModelLoaded?: () => boolean;
  getEmbeddingCacheStats?: () => { totalEmbeddings: number; cacheSizeFormatted: string } | null;
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
      text: 'Neural embeddings provide the most accurate semantic understanding using AI. Requires downloading a 23MB model. All processing happens locally.'
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

    const statusText = statusEl.createEl('span', {
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
}
