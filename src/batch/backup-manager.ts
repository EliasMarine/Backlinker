/**
 * Backup Manager for Batch Auto-Link
 *
 * Creates and restores backups of notes before batch modifications.
 * Backups are stored in the plugin's data folder.
 *
 * Features:
 * - Detailed backup manifests with per-note statistics
 * - Restore history tracking
 * - Configurable backup retention
 */

import { App, TFile, Notice } from 'obsidian';

export interface BackupEntry {
  path: string;
  content: string;
  linksAdded?: number;  // How many links were added to this note
}

export interface BackupManifest {
  id: string;
  timestamp: number;
  noteCount: number;
  linksAdded: number;
  notePaths: string[];

  // Enhanced metadata
  description?: string;           // Human-readable description
  noteDetails?: BackupNoteDetail[]; // Per-note details
  triggeredBy?: 'manual' | 'batch-autolink' | 'clear-all-links' | 'other';
  pluginVersion?: string;
}

export interface BackupNoteDetail {
  path: string;
  title: string;
  linksAdded: number;
  contentLength: number;  // Original content length
}

export interface RestoreRecord {
  id: string;                    // Unique restore ID
  backupId: string;              // Which backup was restored
  timestamp: number;             // When the restore happened
  notesRestored: number;         // How many notes were actually restored
  notesAttempted: number;        // How many notes were in the backup
  errors: string[];              // Any errors during restore
  duration: number;              // How long the restore took (ms)
}

export interface BackupInfo {
  manifest: BackupManifest;
  hasData: boolean;
}

export interface BackupStats {
  totalBackups: number;
  totalRestores: number;
  lastBackupTimestamp?: number;
  lastRestoreTimestamp?: number;
  totalNotesBackedUp: number;
  totalLinksAdded: number;      // Only positive values (from batch auto-link)
  totalLinksRemoved: number;    // Only from clear-all-links operations
  netLinksAdded: number;        // totalLinksAdded - totalLinksRemoved
}

/**
 * Generate a unique backup ID based on timestamp
 */
function generateBackupId(): string {
  return `backup-${Date.now()}`;
}

/**
 * Format a timestamp for display
 */
export function formatBackupDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * BackupManager handles creating and restoring note backups
 */
export class BackupManager {
  private app: App;
  private pluginId: string;
  private backupFolderPath: string;

  // Restore history
  private restoreHistory: RestoreRecord[] = [];
  private restoreHistoryLoaded: boolean = false;

  constructor(app: App, pluginId: string = 'smart-links') {
    this.app = app;
    this.pluginId = pluginId;
    this.backupFolderPath = `.obsidian/plugins/${pluginId}/backups`;
  }

  /**
   * Get the path for backup manifest file
   */
  private getManifestPath(): string {
    return `${this.backupFolderPath}/manifest.json`;
  }

  /**
   * Get the path for a specific backup's data
   */
  private getBackupDataPath(backupId: string): string {
    return `${this.backupFolderPath}/${backupId}.json`;
  }

  /**
   * Ensure the backup folder exists
   */
  private async ensureBackupFolder(): Promise<void> {
    const adapter = this.app.vault.adapter;
    try {
      const exists = await adapter.exists(this.backupFolderPath);
      if (!exists) {
        // Create parent directories if needed
        const parts = this.backupFolderPath.split('/');
        let currentPath = '';
        for (const part of parts) {
          currentPath = currentPath ? `${currentPath}/${part}` : part;
          const partExists = await adapter.exists(currentPath);
          if (!partExists) {
            try {
              await adapter.mkdir(currentPath);
            } catch (e) {
              // Ignore errors if folder already exists (race condition)
              if (!(e instanceof Error && e.message.includes('already exists'))) {
                throw e;
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('[BackupManager] Failed to create backup folder:', error);
      throw new Error(`Failed to create backup folder: ${(error as Error).message}`);
    }
  }

  /**
   * Load the manifest of all backups
   */
  async loadManifests(): Promise<BackupManifest[]> {
    try {
      const adapter = this.app.vault.adapter;
      const manifestPath = this.getManifestPath();

      if (!(await adapter.exists(manifestPath))) {
        return [];
      }

      const content = await adapter.read(manifestPath);
      const data = JSON.parse(content);
      return data.backups || [];
    } catch (error) {
      console.error('[BackupManager] Failed to load manifests:', error);
      return [];
    }
  }

  /**
   * Save the manifest list
   */
  private async saveManifests(manifests: BackupManifest[]): Promise<void> {
    const adapter = this.app.vault.adapter;
    await this.ensureBackupFolder();

    const content = JSON.stringify({ backups: manifests }, null, 2);
    await adapter.write(this.getManifestPath(), content);
  }

  /**
   * Create a backup of the specified notes
   * @param notes Array of note paths and their current content
   * @param linksAdded Number of links that will be added
   * @param options Optional metadata for the backup
   * @returns The created backup manifest
   */
  async createBackup(
    notes: BackupEntry[],
    linksAdded: number,
    options?: {
      description?: string;
      triggeredBy?: 'manual' | 'batch-autolink' | 'clear-all-links' | 'other';
      noteDetails?: BackupNoteDetail[];
    }
  ): Promise<BackupManifest> {
    if (!notes || notes.length === 0) {
      throw new Error('No notes to backup');
    }

    await this.ensureBackupFolder();

    const backupId = generateBackupId();

    // Generate note details if not provided
    const noteDetails: BackupNoteDetail[] = options?.noteDetails || notes.map(n => ({
      path: n.path,
      title: n.path.split('/').pop()?.replace(/\.md$/, '') || n.path,
      linksAdded: n.linksAdded || 0,
      contentLength: n.content.length
    }));

    const manifest: BackupManifest = {
      id: backupId,
      timestamp: Date.now(),
      noteCount: notes.length,
      linksAdded,
      notePaths: notes.map(n => n.path),
      // Enhanced metadata
      description: options?.description || `Batch auto-link: ${linksAdded} links added to ${notes.length} notes`,
      noteDetails,
      triggeredBy: options?.triggeredBy || 'batch-autolink',
      pluginVersion: '1.0.0'
    };

    // Save the backup data
    const adapter = this.app.vault.adapter;
    const backupData = {
      manifest,
      notes
    };

    const backupPath = this.getBackupDataPath(backupId);

    try {
      await adapter.write(backupPath, JSON.stringify(backupData, null, 2));
    } catch (error) {
      console.error(`[BackupManager] Failed to write backup:`, error);
      throw new Error(`Failed to write backup: ${(error as Error).message}`);
    }

    // Verify backup was written
    const exists = await adapter.exists(backupPath);
    if (!exists) {
      throw new Error('Backup file was not created');
    }

    // Update manifests list
    const manifests = await this.loadManifests();
    manifests.unshift(manifest); // Add to beginning (most recent first)

    // Keep only the most recent backups (configurable, default 5)
    const maxBackups = 5;
    while (manifests.length > maxBackups) {
      const old = manifests.pop();
      if (old) {
        // Delete old backup data
        try {
          await adapter.remove(this.getBackupDataPath(old.id));
        } catch {
          // Ignore errors deleting old backups
        }
      }
    }

    await this.saveManifests(manifests);
    return manifest;
  }

  /**
   * Get list of available backups
   */
  async getAvailableBackups(): Promise<BackupInfo[]> {
    const manifests = await this.loadManifests();
    const adapter = this.app.vault.adapter;

    const backups: BackupInfo[] = [];
    for (const manifest of manifests) {
      const dataPath = this.getBackupDataPath(manifest.id);
      const hasData = await adapter.exists(dataPath);
      backups.push({ manifest, hasData });
    }

    return backups;
  }

  /**
   * Check if any backup is available
   */
  async hasBackup(): Promise<boolean> {
    const backups = await this.getAvailableBackups();
    return backups.some(b => b.hasData);
  }

  /**
   * Get the most recent backup
   */
  async getLatestBackup(): Promise<BackupInfo | null> {
    const backups = await this.getAvailableBackups();
    return backups.find(b => b.hasData) || null;
  }

  /**
   * Load backup data for a specific backup ID
   */
  private async loadBackupData(
    backupId: string
  ): Promise<{ manifest: BackupManifest; notes: BackupEntry[] } | null> {
    try {
      const adapter = this.app.vault.adapter;
      const dataPath = this.getBackupDataPath(backupId);

      if (!(await adapter.exists(dataPath))) {
        return null;
      }

      const content = await adapter.read(dataPath);
      return JSON.parse(content);
    } catch (error) {
      console.error(`[BackupManager] Failed to load backup ${backupId}:`, error);
      return null;
    }
  }

  /**
   * Restore notes from a backup
   * @param backupId ID of the backup to restore
   * @param progressCallback Optional callback for progress updates
   * @returns Number of notes restored
   */
  async restoreBackup(
    backupId: string,
    progressCallback?: (current: number, total: number, path: string) => void
  ): Promise<number> {
    const startTime = Date.now();

    const data = await this.loadBackupData(backupId);
    if (!data) {
      throw new Error(`Backup ${backupId} not found or corrupted`);
    }

    const { notes, manifest } = data;

    // Validate backup data
    if (!notes || !Array.isArray(notes) || notes.length === 0) {
      throw new Error('Backup contains no notes');
    }

    // Validate that notes have required fields
    for (const note of notes) {
      if (!note.path || typeof note.content !== 'string') {
        throw new Error(`Invalid note data in backup: ${JSON.stringify(note).slice(0, 100)}`);
      }
    }

    let restoredCount = 0;
    const errors: string[] = [];

    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      progressCallback?.(i + 1, notes.length, note.path);

      try {
        const file = this.app.vault.getAbstractFileByPath(note.path);

        if (file instanceof TFile) {
          await this.app.vault.modify(file, note.content);
          restoredCount++;
        } else {
          // File may have been deleted or moved - try to recreate
          try {
            // Ensure parent folder exists
            const parentPath = note.path.substring(0, note.path.lastIndexOf('/'));
            if (parentPath) {
              const parentExists = await this.app.vault.adapter.exists(parentPath);
              if (!parentExists) {
                await this.app.vault.createFolder(parentPath);
              }
            }
            await this.app.vault.create(note.path, note.content);
            restoredCount++;
          } catch (createError) {
            const errorMsg = `Failed to recreate ${note.path}: ${(createError as Error).message}`;
            console.error(`[BackupManager] ${errorMsg}`);
            errors.push(errorMsg);
          }
        }
      } catch (error) {
        const errorMsg = `Failed to restore ${note.path}: ${(error as Error).message}`;
        console.error(`[BackupManager] ${errorMsg}`);
        errors.push(errorMsg);
      }

      // Yield to event loop
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    const duration = Date.now() - startTime;

    // Record the restore in history
    const restoreRecord: RestoreRecord = {
      id: `restore-${Date.now()}`,
      backupId,
      timestamp: Date.now(),
      notesRestored: restoredCount,
      notesAttempted: notes.length,
      errors: errors.slice(0, 10), // Keep only first 10 errors
      duration
    };

    await this.addRestoreRecord(restoreRecord);

    return restoredCount;
  }

  /**
   * Delete a specific backup
   */
  async deleteBackup(backupId: string): Promise<void> {
    const adapter = this.app.vault.adapter;

    // Remove backup data file
    const dataPath = this.getBackupDataPath(backupId);
    if (await adapter.exists(dataPath)) {
      await adapter.remove(dataPath);
    }

    // Update manifests
    const manifests = await this.loadManifests();
    const filtered = manifests.filter(m => m.id !== backupId);
    await this.saveManifests(filtered);
  }

  /**
   * Delete all backups
   */
  async clearAllBackups(): Promise<void> {
    const adapter = this.app.vault.adapter;
    const manifests = await this.loadManifests();

    for (const manifest of manifests) {
      const dataPath = this.getBackupDataPath(manifest.id);
      if (await adapter.exists(dataPath)) {
        await adapter.remove(dataPath);
      }
    }

    await this.saveManifests([]);
  }

  // ==================== RESTORE HISTORY ====================

  /**
   * Get the path for restore history file
   */
  private getRestoreHistoryPath(): string {
    return `${this.backupFolderPath}/restore-history.json`;
  }

  /**
   * Load restore history from disk
   */
  async loadRestoreHistory(): Promise<RestoreRecord[]> {
    if (this.restoreHistoryLoaded) {
      return this.restoreHistory;
    }

    try {
      const adapter = this.app.vault.adapter;
      const historyPath = this.getRestoreHistoryPath();

      if (!(await adapter.exists(historyPath))) {
        this.restoreHistory = [];
        this.restoreHistoryLoaded = true;
        return [];
      }

      const content = await adapter.read(historyPath);
      const data = JSON.parse(content);
      this.restoreHistory = data.restores || [];
      this.restoreHistoryLoaded = true;
      return this.restoreHistory;
    } catch (error) {
      console.error('[BackupManager] Failed to load restore history:', error);
      this.restoreHistory = [];
      this.restoreHistoryLoaded = true;
      return [];
    }
  }

  /**
   * Save restore history to disk
   */
  private async saveRestoreHistory(): Promise<void> {
    const adapter = this.app.vault.adapter;
    await this.ensureBackupFolder();

    const content = JSON.stringify({ restores: this.restoreHistory }, null, 2);
    await adapter.write(this.getRestoreHistoryPath(), content);
  }

  /**
   * Add a restore record to history
   */
  private async addRestoreRecord(record: RestoreRecord): Promise<void> {
    await this.loadRestoreHistory();

    this.restoreHistory.unshift(record); // Most recent first

    // Keep only last 20 restore records
    const maxRecords = 20;
    if (this.restoreHistory.length > maxRecords) {
      this.restoreHistory = this.restoreHistory.slice(0, maxRecords);
    }

    await this.saveRestoreHistory();
  }

  /**
   * Get restore history
   */
  async getRestoreHistory(): Promise<RestoreRecord[]> {
    return this.loadRestoreHistory();
  }

  /**
   * Get the most recent restore record
   */
  async getLastRestore(): Promise<RestoreRecord | null> {
    const history = await this.loadRestoreHistory();
    return history.length > 0 ? history[0] : null;
  }

  /**
   * Clear restore history
   */
  async clearRestoreHistory(): Promise<void> {
    this.restoreHistory = [];
    this.restoreHistoryLoaded = true;
    await this.saveRestoreHistory();
  }

  // ==================== STATISTICS ====================

  /**
   * Get comprehensive backup and restore statistics
   *
   * Stats are calculated separately for add vs remove operations:
   * - totalLinksAdded: Sum of all positive linksAdded values (from batch auto-link)
   * - totalLinksRemoved: Absolute value of negative linksAdded (from clear-all-links)
   * - netLinksAdded: totalLinksAdded - totalLinksRemoved
   */
  async getStats(): Promise<BackupStats> {
    const manifests = await this.loadManifests();
    const restoreHistory = await this.loadRestoreHistory();

    let totalNotesBackedUp = 0;
    let totalLinksAdded = 0;
    let totalLinksRemoved = 0;
    let lastBackupTimestamp: number | undefined;

    for (const manifest of manifests) {
      totalNotesBackedUp += manifest.noteCount;

      // Separate positive (adds) from negative (removes)
      if (manifest.linksAdded > 0) {
        totalLinksAdded += manifest.linksAdded;
      } else if (manifest.linksAdded < 0) {
        // Clear operations record negative values
        totalLinksRemoved += Math.abs(manifest.linksAdded);
      }

      if (!lastBackupTimestamp || manifest.timestamp > lastBackupTimestamp) {
        lastBackupTimestamp = manifest.timestamp;
      }
    }

    const lastRestore = restoreHistory.length > 0 ? restoreHistory[0] : null;

    return {
      totalBackups: manifests.length,
      totalRestores: restoreHistory.length,
      lastBackupTimestamp,
      lastRestoreTimestamp: lastRestore?.timestamp,
      totalNotesBackedUp,
      totalLinksAdded,
      totalLinksRemoved,
      netLinksAdded: totalLinksAdded - totalLinksRemoved
    };
  }

  /**
   * Get detailed info about a specific backup including note details
   */
  async getBackupDetails(backupId: string): Promise<{
    manifest: BackupManifest;
    notes: BackupEntry[];
  } | null> {
    return this.loadBackupData(backupId);
  }
}
