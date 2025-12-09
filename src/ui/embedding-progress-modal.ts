/**
 * Embedding Progress Modal for Smart Links
 *
 * Displays progress during:
 * - Model download (~23MB)
 * - Batch embedding generation
 *
 * Features:
 * - Animated progress bar
 * - ETA calculation
 * - Cancel button
 * - Error display
 */

import { App, Modal } from 'obsidian';
import { ProgressInfo, BatchProgressInfo } from '../engines/embedding-engine';

export type ModalMode = 'download' | 'embedding';

/**
 * Progress Modal for embedding operations
 */
export class EmbeddingProgressModal extends Modal {
  private mode: ModalMode;
  private progressBar: HTMLDivElement | null = null;
  private progressFill: HTMLDivElement | null = null;
  private statusText: HTMLDivElement | null = null;
  private etaText: HTMLDivElement | null = null;
  private percentageText: HTMLDivElement | null = null;
  private cancelButton: HTMLButtonElement | null = null;
  private closeButton: HTMLButtonElement | null = null;
  private errorContainer: HTMLDivElement | null = null;
  private successContainer: HTMLDivElement | null = null;

  private isCancelled: boolean = false;
  private onCancelCallback?: () => void;

  constructor(app: App, mode: ModalMode = 'download') {
    super(app);
    this.mode = mode;
  }

  /**
   * Set cancel callback
   */
  onCancel(callback: () => void): this {
    this.onCancelCallback = callback;
    return this;
  }

  /**
   * Check if operation was cancelled
   */
  wasCancelled(): boolean {
    return this.isCancelled;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('smart-links-progress-modal');

    // Title
    const title = this.mode === 'download'
      ? 'Downloading Neural Model'
      : 'Generating Embeddings';

    contentEl.createEl('h2', {
      text: title,
      cls: 'smart-links-modal-title'
    });

    // Status text
    this.statusText = contentEl.createDiv('smart-links-status-text');
    this.statusText.setText(
      this.mode === 'download'
        ? 'Initializing...'
        : 'Preparing to process notes...'
    );

    // ETA text
    this.etaText = contentEl.createDiv('smart-links-eta-text');

    // Progress bar container
    this.progressBar = contentEl.createDiv('smart-links-progress-bar');
    this.progressFill = this.progressBar.createDiv('smart-links-progress-fill');
    this.progressFill.style.width = '0%';
    this.progressFill.setAttribute('data-percentage', '0');

    // Percentage text
    this.percentageText = contentEl.createDiv('smart-links-percentage-text');
    this.percentageText.setText('0%');

    // Button container
    const buttonContainer = contentEl.createDiv('smart-links-button-container');

    // Cancel button
    this.cancelButton = buttonContainer.createEl('button', {
      text: 'Cancel',
      cls: 'smart-links-cancel-button'
    });
    this.cancelButton.addEventListener('click', () => {
      this.handleCancel();
    });

    // Close button (hidden initially)
    this.closeButton = buttonContainer.createEl('button', {
      text: 'Close',
      cls: 'smart-links-close-button'
    });
    this.closeButton.style.display = 'none';
    this.closeButton.addEventListener('click', () => {
      this.close();
    });

    // Error container (hidden initially)
    this.errorContainer = contentEl.createDiv('smart-links-error-container');
    this.errorContainer.style.display = 'none';

    // Success container (hidden initially)
    this.successContainer = contentEl.createDiv('smart-links-success-container');
    this.successContainer.style.display = 'none';
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }

  /**
   * Update progress for model download
   */
  updateDownloadProgress(info: ProgressInfo): void {
    if (this.isCancelled) return;

    switch (info.status) {
      case 'downloading':
        this.updateProgress(info.progress || 0);
        // Use the message from the engine if available
        if (info.message) {
          this.statusText?.setText(info.message);
        } else if (info.file) {
          this.statusText?.setText(`Downloading: ${info.file}`);
        }
        // Show download size if available
        if (info.loaded && info.total) {
          const loadedMB = (info.loaded / (1024 * 1024)).toFixed(1);
          const totalMB = (info.total / (1024 * 1024)).toFixed(1);
          this.etaText?.setText(`${loadedMB} MB / ${totalMB} MB`);
        } else {
          this.etaText?.setText('');
        }
        break;

      case 'loading':
        this.updateProgress(info.progress || 95);
        // Show the specific loading message from the engine
        this.statusText?.setText(info.message || 'Loading model into memory...');
        this.etaText?.setText('Please wait, this may take a moment...');
        break;

      case 'ready':
        this.showSuccess('Model Ready!', 'Neural embeddings are now enabled. Your notes will be processed next.');
        break;

      case 'error':
        this.showError('Download Failed', info.message || 'Unknown error occurred');
        break;
    }
  }

  /**
   * Update progress for batch embedding generation
   */
  updateBatchProgress(info: BatchProgressInfo): void {
    if (this.isCancelled) return;

    // Guard against invalid values
    const current = typeof info.current === 'number' && !isNaN(info.current) ? info.current : 0;
    const total = typeof info.total === 'number' && !isNaN(info.total) && info.total > 0 ? info.total : 1;
    const percentage = Math.min(100, Math.max(0, Math.round((current / total) * 100)));
    this.updateProgress(percentage);

    // Show which note is being processed
    const noteName = info.notePath?.split('/').pop()?.replace('.md', '') || 'note';
    const truncatedName = noteName.length > 30 ? noteName.substring(0, 27) + '...' : noteName;
    this.statusText?.setText(`Analyzing: ${truncatedName}`);

    // Show progress count and ETA
    if (info.eta !== undefined && info.eta > 0) {
      const etaMinutes = Math.floor(info.eta / 60);
      const etaSeconds = info.eta % 60;
      const etaStr = etaMinutes > 0 ? `${etaMinutes}m ${etaSeconds}s` : `${etaSeconds}s`;
      this.etaText?.setText(`${current}/${total} notes • ${etaStr} remaining`);
    } else {
      this.etaText?.setText(`${current}/${total} notes processed`);
    }
  }

  /**
   * Show completion state
   */
  showComplete(count: number): void {
    this.updateProgress(100);
    this.showSuccess(
      'Embeddings Generated!',
      `Successfully processed ${count} notes.`
    );
  }

  /**
   * Update the progress bar
   */
  private updateProgress(percentage: number): void {
    const clampedPercentage = Math.max(0, Math.min(100, percentage));

    if (this.progressFill) {
      this.progressFill.style.width = `${clampedPercentage}%`;
      this.progressFill.setAttribute('data-percentage', clampedPercentage.toString());
    }

    if (this.percentageText) {
      this.percentageText.setText(`${clampedPercentage}%`);
    }
  }

  /**
   * Show error state
   */
  showError(title: string, message: string): void {
    if (this.errorContainer) {
      this.errorContainer.style.display = 'block';
      this.errorContainer.empty();
      this.errorContainer.createDiv({
        text: title,
        cls: 'smart-links-error-title'
      });
      this.errorContainer.createDiv({
        text: message,
        cls: 'smart-links-error-message'
      });
    }

    // Hide cancel, show close
    if (this.cancelButton) {
      this.cancelButton.style.display = 'none';
    }
    if (this.closeButton) {
      this.closeButton.style.display = 'inline-block';
    }
  }

  /**
   * Show success state
   */
  private showSuccess(title: string, message: string): void {
    if (this.successContainer) {
      this.successContainer.style.display = 'block';
      this.successContainer.empty();
      this.successContainer.createDiv({
        text: title,
        cls: 'smart-links-success-title'
      });
      this.successContainer.createDiv({
        text: message,
        cls: 'smart-links-success-message'
      });
    }

    // Hide cancel, show close
    if (this.cancelButton) {
      this.cancelButton.style.display = 'none';
    }
    if (this.closeButton) {
      this.closeButton.style.display = 'inline-block';
    }
  }

  /**
   * Handle cancel button click
   */
  private handleCancel(): void {
    this.isCancelled = true;

    if (this.cancelButton) {
      this.cancelButton.disabled = true;
      this.cancelButton.setText('Cancelling...');
    }

    this.statusText?.setText('Cancelling...');

    if (this.onCancelCallback) {
      this.onCancelCallback();
    }

    // Close after a short delay
    setTimeout(() => {
      this.close();
    }, 500);
  }

  /**
   * Change the mode (e.g., from download to embedding)
   */
  setMode(mode: ModalMode): void {
    this.mode = mode;

    const title = mode === 'download'
      ? 'Downloading Neural Model'
      : 'Generating Embeddings';

    const titleEl = this.contentEl.querySelector('.smart-links-modal-title');
    if (titleEl) {
      titleEl.textContent = title;
    }

    // Reset state
    this.updateProgress(0);
    this.statusText?.setText(
      mode === 'download'
        ? 'Initializing...'
        : 'Preparing to process notes...'
    );
    this.etaText?.setText('');

    // Hide error/success containers
    if (this.errorContainer) {
      this.errorContainer.style.display = 'none';
    }
    if (this.successContainer) {
      this.successContainer.style.display = 'none';
    }

    // Show cancel, hide close
    if (this.cancelButton) {
      this.cancelButton.style.display = 'inline-block';
      this.cancelButton.disabled = false;
      this.cancelButton.setText('Cancel');
    }
    if (this.closeButton) {
      this.closeButton.style.display = 'none';
    }
  }
}

/**
 * Confirmation modal for enabling neural embeddings
 */
export class EnableEmbeddingsModal extends Modal {
  private onConfirmCallback?: () => void;

  constructor(app: App) {
    super(app);
  }

  /**
   * Set confirm callback
   */
  onConfirm(callback: () => void): this {
    this.onConfirmCallback = callback;
    return this;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('smart-links-progress-modal');

    // Title
    contentEl.createEl('h2', {
      text: 'Enable Neural Embeddings?',
      cls: 'smart-links-modal-title'
    });

    // Description
    const descEl = contentEl.createDiv({ cls: 'smart-links-modal-description' });
    descEl.style.textAlign = 'center';
    descEl.style.marginBottom = '20px';
    descEl.style.lineHeight = '1.6';

    descEl.createEl('p', {
      text: 'Neural embeddings provide more accurate semantic matching by understanding the meaning of your notes.'
    });

    descEl.createEl('p', {
      text: 'This requires downloading a 23MB model and processing your vault.'
    });

    const noteEl = descEl.createEl('p');
    noteEl.style.color = 'var(--text-muted)';
    noteEl.style.fontSize = '13px';
    noteEl.setText('All processing happens locally on your device. No data is sent to external servers.');

    // Button container
    const buttonContainer = contentEl.createDiv('smart-links-button-container');

    // Cancel button
    const cancelButton = buttonContainer.createEl('button', {
      text: 'Cancel',
      cls: 'smart-links-cancel-button'
    });
    cancelButton.addEventListener('click', () => {
      this.close();
    });

    // Confirm button
    const confirmButton = buttonContainer.createEl('button', {
      text: 'Enable & Download',
      cls: 'smart-links-close-button'
    });
    confirmButton.addEventListener('click', () => {
      this.close();
      if (this.onConfirmCallback) {
        this.onConfirmCallback();
      }
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
