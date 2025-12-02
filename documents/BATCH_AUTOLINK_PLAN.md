# Batch Auto-Link Feature - Implementation Plan

**Created**: December 2, 2025
**Status**: ✅ INTEGRATION COMPLETE - Ready for Testing
**Branch**: `feature/model-selection`
**Completed**: December 2, 2025

---

## Progress Summary

| Phase | Status |
|-------|--------|
| Core Components | ✅ Complete (written previously) |
| Types & Settings | ✅ Complete |
| main.ts Integration | ✅ Complete |
| Commands | ✅ Complete |
| CSS Styles | ✅ Complete |
| Testing | ⏳ Pending |

---

## Overview

The Batch Auto-Link feature allows users to automatically add wikilinks throughout their entire vault in one operation. Unlike the real-time suggestion panel (which suggests links as you type), this feature:

1. Scans all notes in the vault
2. Finds keywords that match other note titles
3. Shows a preview of all proposed changes
4. Creates a backup before applying
5. Applies all changes with one click
6. Allows easy rollback via backup restore

---

## Architecture

### Component Diagram

```
User Action (Command/Ribbon)
    ↓
┌─────────────────────────────────────────────────────────────┐
│                      main.ts                                 │
│  - runBatchAutoLink() method                                │
│  - Command registration                                      │
│  - Ribbon icon (optional)                                   │
└─────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────┐
│              BatchProgressModal (UI)                         │
│  - Shows "Analyzing Notes" progress                         │
│  - Cancel button                                            │
└─────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────┐
│                   BatchLinker                                │
│  - processVault() - analyze all notes                       │
│  - Uses HybridScorer to find similar notes                  │
│  - Uses KeywordMatcher to map keywords                      │
│  - Uses InlineReplacer for safe text replacement            │
└─────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────┐
│              BatchPreviewModal (UI)                          │
│  - Shows summary: "X links in Y notes"                      │
│  - Expandable list of all changes                           │
│  - Context snippets for each replacement                    │
│  - "Cancel" or "Apply" buttons                              │
└─────────────────────────────────────────────────────────────┘
    ↓ (if Apply clicked)
┌─────────────────────────────────────────────────────────────┐
│                  BackupManager                               │
│  - Creates backup of all affected notes                     │
│  - Stores in .obsidian/plugins/smart-links/backups/         │
└─────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────┐
│              BatchProgressModal (UI)                         │
│  - Shows "Applying Changes" progress                        │
│  - Completion message                                       │
└─────────────────────────────────────────────────────────────┘
```

### Existing Components (Already Written)

| Component | File | Status |
|-----------|------|--------|
| BatchLinker | `src/batch/batch-linker.ts` | ✅ Complete |
| KeywordMatcher | `src/batch/keyword-matcher.ts` | ✅ Complete |
| InlineReplacer | `src/batch/inline-replacer.ts` | ✅ Complete |
| BackupManager | `src/batch/backup-manager.ts` | ✅ Complete |
| BatchPreviewModal | `src/ui/batch-preview-modal.ts` | ✅ Complete |
| BatchProgressModal | `src/ui/batch-progress-modal.ts` | ✅ Complete |

### Components Needing Integration

| Component | File | Status |
|-----------|------|--------|
| Plugin Integration | `main.ts` | ✅ Complete |
| Settings UI | `src/settings.ts` | ✅ Complete (was already done) |
| Types | `src/types/index.ts` | ✅ Complete (was already done) |
| CSS Styles | `styles.css` | ✅ Complete |
| Confirm Restore Modal | `main.ts` | ✅ Complete |

---

## Implementation Steps

### ✅ Step 1: Update Types (if needed) - ALREADY DONE

Types were already defined in `src/types/index.ts`:

```typescript
export interface BatchLinkSettings {
  enablePreviewMode: boolean;     // Show preview before applying (default: true)
  confidenceThreshold: number;    // Minimum confidence (default: 0.3)
  maxLinksPerNote: number;        // Maximum links to add per note (default: 10)
  lastRunTimestamp?: number;      // Track last execution
}
```

### ✅ Step 2: Update Default Settings - ALREADY DONE

Defaults were already in `src/types/index.ts`:

```typescript
batchLinkSettings: {
  enablePreviewMode: true,
  confidenceThreshold: 0.3,
  maxLinksPerNote: 10,
}
```

### ✅ Step 3: Import BatchLinker in main.ts - COMPLETE

Added to `main.ts` (lines 14-17):

```typescript
import { BatchLinker, BatchLinkOptions, BatchLinkSummary } from './src/batch/batch-linker';
import { BatchPreviewModal, PreviewResult } from './src/ui/batch-preview-modal';
import { BatchProgressModal } from './src/ui/batch-progress-modal';
import { BackupManifest, formatBackupDate } from './src/batch/backup-manager';
```

### ✅ Step 4: Add BatchLinker Instance to Plugin - COMPLETE

Added to `main.ts`:
- Property: `private batchLinker: BatchLinker | null = null;` (line 44)
- State flag: `private isBatchLinking: boolean = false;` (line 50)
- Initialization in `onload()` (lines 141-149)

### ✅ Step 5: Add runBatchAutoLink Method - COMPLETE

```typescript
async runBatchAutoLink(): Promise<void> {
  if (!this.batchLinker || !this.cache) {
    new Notice('Please wait for vault indexing to complete');
    return;
  }

  const options: BatchLinkOptions = {
    previewOnly: true,
    confidenceThreshold: this.settings.batchConfidenceThreshold,
    maxLinksPerNote: this.settings.batchMaxLinksPerNote
  };

  // Show progress modal
  const progressModal = new BatchProgressModal(this.app);
  progressModal.onCancel(() => {
    this.batchLinker?.cancel();
  });
  progressModal.open();

  try {
    // Phase 1: Analyze vault
    const summary = await this.batchLinker.processVault(options, (progress) => {
      progressModal.updateProgress(progress);
    });

    progressModal.close();

    // Phase 2: Show preview
    const previewModal = new BatchPreviewModal(this.app, summary);

    previewModal.onResult(async (result: PreviewResult) => {
      if (result === 'apply' && summary.results.length > 0) {
        await this.applyBatchChanges(summary);
      }
    });

    previewModal.open();

  } catch (error) {
    progressModal.showError('Error', error.message);
    console.error('[SmartLinks] Batch auto-link error:', error);
  }
}

async applyBatchChanges(summary: BatchLinkSummary): Promise<void> {
  const progressModal = new BatchProgressModal(this.app);
  progressModal.onCancel(() => {
    this.batchLinker?.cancel();
  });
  progressModal.open();

  try {
    const { backupId, appliedCount } = await this.batchLinker!.applyChanges(
      summary.results,
      (progress) => {
        progressModal.updateProgress(progress);
      }
    );

    progressModal.showComplete(
      `Added ${summary.totalLinksAdded} links to ${appliedCount} notes. Backup: ${backupId}`
    );

    new Notice(`Auto-linked ${summary.totalLinksAdded} connections!`);

  } catch (error) {
    progressModal.showError('Error', error.message);
    console.error('[SmartLinks] Apply changes error:', error);
  }
}
```

### ✅ Step 6: Register Command - COMPLETE

Added to `main.ts` in `registerCommands()` (lines 386-402):

```typescript
// Command: Batch auto-link vault
this.addCommand({
  id: 'batch-auto-link',
  name: 'Auto-link vault',
  callback: async () => {
    await this.runBatchAutoLink();
  }
});

// Command: Restore from batch backup
this.addCommand({
  id: 'restore-batch-backup',
  name: 'Restore notes from batch link backup',
  callback: async () => {
    await this.restoreFromBackup();
  }
});
```

### ⏭️ Step 7: Add Ribbon Icon (Optional) - SKIPPED

Decided not to add ribbon icon to keep UI clean. Feature accessible via:
- Command palette (`Cmd+P` → "Auto-link vault")
- Settings button

### ✅ Step 8: Add Settings UI - ALREADY DONE

```typescript
// In SmartLinksSettingTab.display()

// Batch Auto-Link Section
containerEl.createEl('h3', { text: 'Batch Auto-Link' });

new Setting(containerEl)
  .setName('Confidence threshold')
  .setDesc('Minimum confidence score for auto-linking (0.0-1.0). Higher = fewer but more accurate links.')
  .addSlider(slider => slider
    .setLimits(0.1, 0.9, 0.05)
    .setValue(this.plugin.settings.batchConfidenceThreshold)
    .setDynamicTooltip()
    .onChange(async (value) => {
      this.plugin.settings.batchConfidenceThreshold = value;
      await this.plugin.saveSettings();
    }));

new Setting(containerEl)
  .setName('Max links per note')
  .setDesc('Maximum number of links to add to each note')
  .addSlider(slider => slider
    .setLimits(1, 20, 1)
    .setValue(this.plugin.settings.batchMaxLinksPerNote)
    .setDynamicTooltip()
    .onChange(async (value) => {
      this.plugin.settings.batchMaxLinksPerNote = value;
      await this.plugin.saveSettings();
    }));

new Setting(containerEl)
  .setName('Run Auto-Link')
  .setDesc('Analyze your vault and add links to all notes')
  .addButton(button => button
    .setButtonText('Auto-Link Vault')
    .setCta()
    .onClick(async () => {
      await this.plugin.runBatchAutoLink();
    }));
```

### ✅ Step 9: Add Restore Backup UI - ALREADY DONE

Settings UI already had restore functionality in `src/settings.ts`.

### ✅ Step 10: Add Restore Method - COMPLETE

```typescript
// In main.ts
async restoreLastBackup(): Promise<void> {
  if (!this.batchLinker) {
    new Notice('Batch linker not initialized');
    return;
  }

  const backupManager = this.batchLinker.getBackupManager();
  const latestBackup = await backupManager.getLatestBackup();

  if (!latestBackup || !latestBackup.hasData) {
    new Notice('No backup available to restore');
    return;
  }

  const manifest = latestBackup.manifest;
  const confirmed = await this.confirmRestore(manifest);

  if (!confirmed) return;

  try {
    const restoredCount = await backupManager.restoreBackup(manifest.id);
    new Notice(`Restored ${restoredCount} notes from backup`);
  } catch (error) {
    new Notice(`Restore failed: ${error.message}`);
    console.error('[SmartLinks] Restore error:', error);
  }
}

async confirmRestore(manifest: BackupManifest): Promise<boolean> {
  // Use a simple confirmation via Notice + command
  // Or implement a confirmation modal
  return new Promise((resolve) => {
    const modal = new ConfirmModal(
      this.app,
      'Restore Backup?',
      `This will restore ${manifest.noteCount} notes to their state before ${manifest.linksAdded} links were added.`,
      () => resolve(true),
      () => resolve(false)
    );
    modal.open();
  });
}
```

---

## Testing Plan

### Unit Tests (if time permits)

1. **InlineReplacer**: Test protected zone detection
2. **KeywordMatcher**: Test keyword-to-title matching
3. **BatchLinker**: Test note processing logic

### Manual Testing Checklist

- [ ] Command appears in command palette
- [ ] Progress modal shows during analysis
- [ ] Can cancel during analysis
- [ ] Preview modal shows correct summary
- [ ] Preview modal shows expandable note list
- [ ] Context snippets are correct
- [ ] Cancel in preview closes without changes
- [ ] Apply creates backup first
- [ ] Apply modifies files correctly
- [ ] Wikilinks are properly formatted
- [ ] Protected zones (code, frontmatter, existing links) are skipped
- [ ] Restore backup works correctly
- [ ] Settings sliders work
- [ ] Settings button triggers auto-link

### Edge Cases to Test

- [ ] Empty vault (no notes)
- [ ] Single note vault
- [ ] Note with no matches
- [ ] Note with existing links to targets
- [ ] Note with code blocks containing keywords
- [ ] Note with frontmatter containing keywords
- [ ] Very large vault (500+ notes)
- [ ] Cancel during apply phase

---

## ✅ CSS Styles - COMPLETE

All styles added to `styles.css` (lines 431-676). Includes:

```css
/* Batch Preview Modal */
.smart-links-batch-preview-modal {
  max-width: 600px;
}

.smart-links-batch-summary {
  padding: 1em;
  background: var(--background-secondary);
  border-radius: 8px;
  margin-bottom: 1em;
}

.smart-links-batch-summary-main {
  font-size: 1.2em;
  font-weight: 600;
}

.smart-links-batch-stats {
  font-size: 0.9em;
  color: var(--text-muted);
  margin-top: 0.5em;
}

.smart-links-batch-list {
  max-height: 400px;
  overflow-y: auto;
  border: 1px solid var(--background-modifier-border);
  border-radius: 8px;
}

.smart-links-batch-note {
  border-bottom: 1px solid var(--background-modifier-border);
}

.smart-links-batch-note:last-child {
  border-bottom: none;
}

.smart-links-batch-note-header {
  padding: 0.75em 1em;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.5em;
}

.smart-links-batch-note-header:hover {
  background: var(--background-modifier-hover);
}

.smart-links-batch-expand-icon {
  font-size: 0.8em;
  color: var(--text-muted);
}

.smart-links-batch-note-title {
  flex: 1;
  font-weight: 500;
}

.smart-links-batch-link-count {
  background: var(--interactive-accent);
  color: var(--text-on-accent);
  padding: 0.2em 0.6em;
  border-radius: 12px;
  font-size: 0.85em;
}

.smart-links-batch-replacements {
  padding: 0.5em 1em 1em 2em;
  background: var(--background-secondary);
}

.smart-links-batch-replacement {
  margin-bottom: 0.75em;
}

.smart-links-batch-mapping {
  font-family: var(--font-monospace);
  font-size: 0.9em;
}

.smart-links-batch-keyword {
  color: var(--text-accent);
}

.smart-links-batch-arrow {
  color: var(--text-muted);
}

.smart-links-batch-target {
  color: var(--text-success);
}

.smart-links-batch-context {
  font-size: 0.85em;
  color: var(--text-muted);
  margin-top: 0.25em;
  padding: 0.25em 0.5em;
  background: var(--background-primary);
  border-radius: 4px;
}

.smart-links-batch-highlight {
  background: var(--text-highlight-bg);
  padding: 0 0.25em;
}

.smart-links-batch-warning {
  padding: 0.75em;
  background: var(--background-modifier-success);
  border-radius: 8px;
  margin: 1em 0;
  font-size: 0.9em;
}

.smart-links-batch-buttons {
  display: flex;
  justify-content: flex-end;
  gap: 0.75em;
  margin-top: 1em;
}

.smart-links-batch-empty {
  padding: 2em;
  text-align: center;
}

.smart-links-muted {
  color: var(--text-muted);
}

/* Batch Progress Modal */
.smart-links-progress-modal {
  max-width: 400px;
}

.smart-links-phase-text {
  font-size: 1.1em;
  font-weight: 600;
  margin-bottom: 0.5em;
}

.smart-links-status-text {
  color: var(--text-muted);
  margin-bottom: 1em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.smart-links-progress-bar {
  height: 8px;
  background: var(--background-modifier-border);
  border-radius: 4px;
  overflow: hidden;
}

.smart-links-progress-fill {
  height: 100%;
  background: var(--interactive-accent);
  transition: width 0.3s ease;
}

.smart-links-percentage-text {
  text-align: center;
  margin-top: 0.5em;
  font-size: 0.9em;
  color: var(--text-muted);
}

.smart-links-button-container {
  display: flex;
  justify-content: center;
  gap: 0.75em;
  margin-top: 1.5em;
}

.smart-links-error-text {
  color: var(--text-error);
}
```

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Data loss from incorrect replacements | High | Backup system, preview before apply |
| Over-linking (too many links) | Medium | Max links per note setting, confidence threshold |
| Performance on large vaults | Medium | Progress modal, cancellation support, yielding |
| Incorrect keyword matching | Medium | Word boundary regex, protected zone detection |
| UI freeze during processing | Low | Event loop yielding already implemented |

---

## Future Enhancements (Post-MVP)

1. **Selective auto-link**: Choose specific folders/tags to process
2. **Exclude specific notes**: Blacklist certain notes from auto-linking
3. **Link type options**: Support for markdown links `[text](note.md)` instead of wikilinks
4. **Dry-run reports**: Export preview as markdown report
5. **Incremental mode**: Only process notes modified since last run
6. **Undo individual changes**: Granular restore instead of full backup restore

---

## Timeline

This is a focused integration task. Estimated effort:

1. Types + Settings: ~15 min
2. main.ts integration: ~30 min
3. Settings UI: ~20 min
4. CSS styles: ~15 min
5. Testing: ~30 min

**Total: ~2 hours**

---

## Success Criteria (Pending Testing)

| Criteria | Code Ready | Tested |
|----------|------------|--------|
| User can trigger "Auto-Link Vault" from command palette | ✅ | ⏳ |
| Progress shows during vault analysis | ✅ | ⏳ |
| Preview modal displays all proposed changes accurately | ✅ | ⏳ |
| Changes are applied correctly with backup created | ✅ | ⏳ |
| Restore backup works to undo changes | ✅ | ⏳ |
| Settings allow customizing confidence threshold and max links | ✅ | ⏳ |
| No data loss or corruption | ✅ | ⏳ |
| Works with 100+ note vaults without freezing | ✅ | ⏳ |

---

## What Was Implemented

### Files Modified

1. **`main.ts`**
   - Added imports (lines 14-17)
   - Added `batchLinker` property (line 44)
   - Added `isBatchLinking` state (line 50)
   - Added initialization (lines 141-149)
   - Added commands (lines 386-402)
   - Added `runBatchAutoLink()` method (lines 866-944)
   - Added `applyBatchChanges()` method (lines 950-982)
   - Added `restoreFromBackup()` method (lines 987-1045)
   - Added `confirmRestore()` method (lines 1050-1060)
   - Added `hasBackupAvailable()` method (lines 1065-1068)
   - Added `getLatestBackupInfo()` method (lines 1073-1082)
   - Added `ConfirmRestoreModal` class (lines 1088-1148)

2. **`styles.css`**
   - Added batch preview modal styles (lines 435-576)
   - Added confirm restore modal styles (lines 603-634)
   - Added featured settings section styles (lines 636-676)

### Commands Available

| Command | ID | Description |
|---------|-----|-------------|
| Auto-link vault | `batch-auto-link` | Run batch auto-linking |
| Restore notes from batch link backup | `restore-batch-backup` | Restore from backup |

### Methods Added to Plugin

| Method | Description |
|--------|-------------|
| `runBatchAutoLink()` | Main entry point for batch auto-link |
| `applyBatchChanges()` | Apply changes after preview |
| `restoreFromBackup()` | Restore from last backup |
| `confirmRestore()` | Show confirmation modal |
| `hasBackupAvailable()` | Check if backup exists (for UI) |
| `getLatestBackupInfo()` | Get backup info (for UI) |
