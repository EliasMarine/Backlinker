/**
 * Batch Progress Modal for Smart Links
 *
 * Displays progress during batch auto-linking operations.
 *
 * Features:
 * - Animated progress bar
 * - Phase indicators (analyzing, applying, backup)
 * - Current note display
 * - Cancel button
 */

import { App, Modal } from 'obsidian';
import { BatchProgress } from '../batch/batch-linker';

/**
 * Progress Modal for batch linking operations
 */
export class BatchProgressModal extends Modal {
  private progressBar: HTMLDivElement | null = null;
  private progressFill: HTMLDivElement | null = null;
  private phaseText: HTMLDivElement | null = null;
  private statusText: HTMLDivElement | null = null;
  private percentageText: HTMLDivElement | null = null;
  private cancelButton: HTMLButtonElement | null = null;
  private closeButton: HTMLButtonElement | null = null;

  private isCancelled: boolean = false;
  private onCancelCallback?: () => void;

  constructor(app: App) {
    super(app);
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
    contentEl.createEl('h2', {
      text: 'Auto-Linking Vault',
      cls: 'smart-links-modal-title'
    });

    // Phase text
    this.phaseText = contentEl.createDiv('smart-links-phase-text');
    this.phaseText.setText('Preparing...');

    // Status text (current note)
    this.statusText = contentEl.createDiv('smart-links-status-text');
    this.statusText.setText('Initializing...');

    // Progress bar container
    this.progressBar = contentEl.createDiv('smart-links-progress-bar');
    this.progressFill = this.progressBar.createDiv('smart-links-progress-fill');
    this.progressFill.style.width = '0%';

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
      this.isCancelled = true;
      this.cancelButton?.setText('Cancelling...');
      this.cancelButton?.setAttribute('disabled', 'true');
      this.onCancelCallback?.();
    });

    // Close button (hidden initially)
    this.closeButton = buttonContainer.createEl('button', {
      text: 'Close',
      cls: 'mod-cta smart-links-close-button'
    });
    this.closeButton.style.display = 'none';
    this.closeButton.addEventListener('click', () => {
      this.close();
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }

  /**
   * Update progress display
   */
  updateProgress(progress: BatchProgress): void {
    if (this.isCancelled && progress.phase !== 'complete') return;

    // Update phase text
    if (this.phaseText) {
      const phaseLabels: Record<string, string> = {
        analyzing: 'Analyzing Notes',
        backup: 'Creating Backup',
        applying: 'Applying Changes',
        complete: 'Complete'
      };
      this.phaseText.setText(phaseLabels[progress.phase] || progress.phase);
    }

    // Update status text
    if (this.statusText) {
      this.statusText.setText(progress.message);
    }

    // Update progress bar with guards for edge cases
    const current = typeof progress.current === 'number' && !isNaN(progress.current) ? progress.current : 0;
    const total = typeof progress.total === 'number' && !isNaN(progress.total) ? progress.total : 0;
    const percentage = total > 0
      ? Math.min(100, Math.max(0, Math.round((current / total) * 100)))
      : 0;

    if (this.progressFill) {
      this.progressFill.style.width = `${percentage}%`;
    }

    if (this.percentageText) {
      this.percentageText.setText(`${percentage}% (${current}/${total})`);
    }

    // Handle completion
    if (progress.phase === 'complete') {
      this.showComplete(progress.message, current, total);
    }
  }

  /**
   * Show completion state
   */
  showComplete(message: string, current?: number, total?: number): void {
    if (this.phaseText) {
      this.phaseText.setText('Complete');
    }

    if (this.statusText) {
      this.statusText.setText(message);
    }

    if (this.progressFill) {
      this.progressFill.style.width = '100%';
    }

    // Update percentage text to show 100%
    if (this.percentageText) {
      if (typeof current === 'number' && typeof total === 'number') {
        this.percentageText.setText(`100% (${current}/${total})`);
      } else {
        this.percentageText.setText('100%');
      }
    }

    // Hide cancel, show close
    if (this.cancelButton) {
      this.cancelButton.style.display = 'none';
    }
    if (this.closeButton) {
      this.closeButton.style.display = 'block';
    }
  }

  /**
   * Show error state
   */
  showError(title: string, message: string): void {
    if (this.phaseText) {
      this.phaseText.setText(title);
      this.phaseText.addClass('smart-links-error-text');
    }

    if (this.statusText) {
      this.statusText.setText(message);
    }

    // Keep percentage visible but don't change it
    // (shows where it failed)

    // Hide cancel, show close
    if (this.cancelButton) {
      this.cancelButton.style.display = 'none';
    }
    if (this.closeButton) {
      this.closeButton.style.display = 'block';
    }
  }

  /**
   * Show cancelled state
   */
  showCancelled(): void {
    if (this.phaseText) {
      this.phaseText.setText('Cancelled');
    }

    if (this.statusText) {
      this.statusText.setText('Operation was cancelled by user');
    }

    // Update percentage text to show cancelled state
    if (this.percentageText) {
      // Get current percentage from progress fill width
      const currentWidth = this.progressFill?.style.width || '0%';
      this.percentageText.setText(`${currentWidth} (cancelled)`);
    }

    // Hide cancel, show close
    if (this.cancelButton) {
      this.cancelButton.style.display = 'none';
    }
    if (this.closeButton) {
      this.closeButton.style.display = 'block';
    }
  }
}
