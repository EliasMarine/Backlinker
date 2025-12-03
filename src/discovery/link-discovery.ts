/**
 * Link Discovery for Smart Links
 *
 * Real-time discovery of link suggestions as user types
 * Monitors active note and generates suggestions using hybrid scoring
 */

import { App, TFile } from 'obsidian';
import { VaultCache, SmartLinksSettings, LinkSuggestion, NoteIndex } from '../types';
import { HybridScorer, HybridResult } from '../engines/hybrid-scorer';
import { ContentParser } from '../parsers/content-parser';
import { NLPProcessor } from '../nlp/nlp-processor';

export interface SuggestionUpdate {
  suggestions: LinkSuggestion[];
  sourceNotePath: string;
  timestamp: number;
}

/**
 * Link Discovery Engine
 * Handles real-time suggestion generation
 */
export class LinkDiscovery {
  private app: App;
  private cache: VaultCache;
  private settings: SmartLinksSettings;
  private hybridScorer: HybridScorer;
  private contentParser: ContentParser;
  private nlpProcessor: NLPProcessor;

  // Current state
  private currentSuggestions: LinkSuggestion[] = [];
  private lastAnalyzedContent: string = '';
  private documentFrequencyWarningShown: boolean = false;

  // Callbacks
  private onSuggestionsUpdated?: (update: SuggestionUpdate) => void;

  constructor(
    app: App,
    cache: VaultCache,
    settings: SmartLinksSettings,
    hybridScorer: HybridScorer
  ) {
    this.app = app;
    this.cache = cache;
    this.settings = settings;
    this.hybridScorer = hybridScorer;
    this.contentParser = new ContentParser();
    this.nlpProcessor = new NLPProcessor();
  }

  /**
   * Register callback for when suggestions are updated
   */
  onUpdate(callback: (update: SuggestionUpdate) => void) {
    this.onSuggestionsUpdated = callback;
  }

  /**
   * Analyze current note content and generate suggestions
   * This is called from debounced editor events
   */
  async analyzeCurrentNote(file: TFile | null): Promise<void> {
    if (!file) {
      this.clearSuggestions();
      return;
    }

    if (!this.settings.enableRealTimeSuggestions) {
      return;
    }

    try {
      // Read current content
      const content = await this.app.vault.read(file);

      // Skip if content hasn't changed meaningfully
      if (this.isSimilarContent(content, this.lastAnalyzedContent)) {
        return;
      }

      this.lastAnalyzedContent = content;

      // Generate suggestions
      const suggestions = await this.generateSuggestions(file, content);

      // Update state
      this.currentSuggestions = suggestions;

      // Notify listeners
      if (this.onSuggestionsUpdated) {
        this.onSuggestionsUpdated({
          suggestions,
          sourceNotePath: file.path,
          timestamp: Date.now()
        });
      }
    } catch (error) {
      console.error('[Smart Links] Failed to analyze current note:', error);
    }
  }

  /**
   * Generate link suggestions for a note
   */
  private async generateSuggestions(
    file: TFile,
    content: string
  ): Promise<LinkSuggestion[]> {
    // Check if document frequency is populated (debounce warning)
    if (this.cache.documentFrequency.size === 0) {
      if (!this.documentFrequencyWarningShown) {
        console.warn('[Smart Links] Cannot generate suggestions - documentFrequency is empty');
        console.warn('[Smart Links] Please run "Analyze entire vault" command first');
        this.documentFrequencyWarningShown = true;
      }
      return [];
    }
    // Reset warning flag when document frequency becomes available
    this.documentFrequencyWarningShown = false;

    // Create temporary note index for current content
    let tempNote: NoteIndex;
    try {
      tempNote = await this.createTempNoteIndex(file, content);
    } catch (error) {
      console.error('[LinkDiscovery] Failed to create temp note index:', error);
      return [];
    }

    console.log('[LinkDiscovery] Calling hybridScorer.findSimilarNotes()...');

    // Find similar notes using hybrid scoring with proper error handling
    let similarNotes: HybridResult[];
    try {
      similarNotes = await this.hybridScorer.findSimilarNotes(
        tempNote,
        this.settings.maxRealtimeSuggestions
      );
    } catch (error) {
      console.error('[LinkDiscovery] Hybrid scorer error:', error);
      return [];
    }

    console.log('[LinkDiscovery] HybridScorer returned', similarNotes.length, 'similar notes');
    if (similarNotes.length > 0) {
      console.log('[LinkDiscovery] Top 3 results:', similarNotes.slice(0, 3).map(r => ({
        title: r.note.title,
        finalScore: r.finalScore,
        tfidfScore: r.tfidfScore,
        semanticScore: r.semanticScore
      })));
    }

    console.log('[LinkDiscovery] TempNote has', tempNote.existingLinks.length, 'existing links');
    // Filter out already-linked notes
    const filteredNotes = this.filterAlreadyLinked(similarNotes, tempNote);

    console.log('[LinkDiscovery] After filtering already-linked:', filteredNotes.length, 'notes remain');

    // Convert to LinkSuggestion format
    const suggestions = filteredNotes.map((result) =>
      this.createLinkSuggestion(file.path, result)
    );

    console.log('[LinkDiscovery] Final suggestions:', suggestions.length);

    return suggestions;
  }

  /**
   * Create a temporary note index from current content
   * Used for real-time analysis without modifying the cache
   */
  private async createTempNoteIndex(file: TFile, content: string): Promise<NoteIndex> {
    // Parse content
    const parsed = this.contentParser.parse(content, file.path);

    // Extract keywords
    const keywords = this.nlpProcessor.extractKeywords(parsed.cleanText);

    // Get word frequency from full text (matches vault indexer behavior)
    const wordFrequency = this.nlpProcessor.getWordFrequency(parsed.cleanText);

    // Calculate TF-IDF vector using cache's document frequency
    const tfidfVector = this.calculateTFIDFVector(wordFrequency);

    // Diagnostic logging
    console.log('[Smart Links] TempNote vector stats:', {
      path: file.path,
      vectorSize: tfidfVector.size,
      wordFreqSize: wordFrequency.size,
      topTerms: Array.from(tfidfVector.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([term, score]) => `${term}(${score.toFixed(3)})`)
    });

    // Check if note is already in cache (might have embedding)
    const cachedNote = this.cache.notes.get(file.path);

    return {
      path: file.path,
      title: file.basename,
      content: content,
      cleanContent: parsed.cleanText,
      keywords: keywords,
      existingLinks: parsed.links,
      headings: parsed.headings,
      tags: parsed.tags,
      lastModified: file.stat.mtime,
      tfidfVector: tfidfVector,
      wordFrequency: wordFrequency,
      semanticVersion: cachedNote?.semanticVersion
    };
  }

  /**
   * Calculate TF-IDF vector from word frequency
   */
  private calculateTFIDFVector(wordFrequency: Map<string, number>): Map<string, number> {
    const tfidfVector = new Map<string, number>();
    const totalWords = Array.from(wordFrequency.values()).reduce((a, b) => a + b, 0);

    for (const [term, freq] of wordFrequency.entries()) {
      // TF: term frequency normalized by document length
      const tf = freq / Math.max(totalWords, 1);

      // IDF: inverse document frequency from cache
      const docFreq = this.cache.documentFrequency.get(term) || 1;
      const idf = Math.log(this.cache.totalDocuments / docFreq);

      // TF-IDF
      tfidfVector.set(term, tf * idf);
    }

    return tfidfVector;
  }

  /**
   * Filter out notes that are already linked in the source note
   */
  private filterAlreadyLinked(
    results: HybridResult[],
    sourceNote: NoteIndex
  ): HybridResult[] {
    const linkedPaths = new Set(
      sourceNote.existingLinks.map(link => link.targetPath)
    );

    return results.filter(result => !linkedPaths.has(result.note.path));
  }

  /**
   * Create a LinkSuggestion from a HybridResult
   */
  private createLinkSuggestion(
    sourcePath: string,
    result: HybridResult
  ): LinkSuggestion {
    // Generate explanation
    const explanation = this.generateExplanation(result);

    // Extract folder path
    const pathParts = result.note.path.split('/');
    const targetFolder = pathParts.length > 1
      ? pathParts.slice(0, -1).join('/')
      : '';

    // Generate content preview (first ~150 chars, cleaned)
    const contentPreview = this.generateContentPreview(result.note.cleanContent);

    return {
      id: `${sourcePath}-${result.note.path}-${Date.now()}`,
      sourceNote: sourcePath,
      targetNote: result.note.path,
      targetTitle: result.note.title,
      tfidfScore: result.tfidfScore,
      semanticScore: result.semanticScore,
      finalScore: result.finalScore,
      matchedKeywords: result.matchedKeywords,
      matchedPhrases: result.matchedPhrases,
      explanation,
      contentPreview,
      targetFolder,
      targetTags: result.note.tags || [],
      status: 'pending',
      createdAt: Date.now()
    };
  }

  /**
   * Generate a clean content preview for display
   */
  private generateContentPreview(cleanContent: string): string {
    if (!cleanContent) return '';

    // Take first 200 chars, then trim to last complete word
    let preview = cleanContent.slice(0, 200).trim();

    // Remove newlines and extra spaces
    preview = preview.replace(/\s+/g, ' ');

    // Trim to last complete word if we hit the limit
    if (cleanContent.length > 200) {
      const lastSpace = preview.lastIndexOf(' ');
      if (lastSpace > 100) {
        preview = preview.slice(0, lastSpace);
      }
      preview += '...';
    }

    return preview;
  }

  /**
   * Generate human-readable explanation for suggestion
   */
  private generateExplanation(result: HybridResult): string {
    const keywords = result.matchedKeywords.slice(0, 3);
    const scorePercent = Math.round(result.finalScore * 100);

    if (keywords.length > 0) {
      return `${scorePercent}% match - ${keywords.join(', ')}`;
    } else if (result.semanticScore) {
      return `${scorePercent}% semantic match`;
    } else {
      return `${scorePercent}% similarity`;
    }
  }

  /**
   * Check if content has changed meaningfully
   * Avoids re-analysis for minor changes (e.g., single character typo)
   */
  private isSimilarContent(newContent: string, oldContent: string): boolean {
    // If content is empty, consider it different
    if (!newContent || !oldContent) {
      return false;
    }

    // If length difference is significant, content has changed
    const lengthDiff = Math.abs(newContent.length - oldContent.length);
    if (lengthDiff > 50) {
      return false;
    }

    // Simple similarity check (could be improved)
    const similarity = this.simpleStringSimilarity(newContent, oldContent);
    return similarity > 0.95;
  }

  /**
   * Simple string similarity using character-level comparison
   * More accurate than just comparing lengths
   */
  private simpleStringSimilarity(a: string, b: string): number {
    if (a === b) return 1;
    if (!a || !b) return 0;

    const maxLength = Math.max(a.length, b.length);
    if (maxLength === 0) return 1;

    // Compare characters at corresponding positions
    const minLength = Math.min(a.length, b.length);
    let matches = 0;
    for (let i = 0; i < minLength; i++) {
      if (a[i] === b[i]) matches++;
    }

    // Factor in length difference penalty
    const lengthPenalty = 1 - Math.abs(a.length - b.length) / maxLength;

    // Combine character match ratio with length similarity
    const charSimilarity = matches / minLength;
    return (charSimilarity * 0.7) + (lengthPenalty * 0.3);
  }

  /**
   * Clear current suggestions
   */
  private clearSuggestions() {
    this.currentSuggestions = [];
    this.lastAnalyzedContent = '';

    if (this.onSuggestionsUpdated) {
      this.onSuggestionsUpdated({
        suggestions: [],
        sourceNotePath: '',
        timestamp: Date.now()
      });
    }
  }

  /**
   * Get current suggestions
   */
  getCurrentSuggestions(): LinkSuggestion[] {
    return this.currentSuggestions;
  }

  /**
   * Update settings
   */
  updateSettings(settings: SmartLinksSettings) {
    this.settings = settings;
    this.hybridScorer.updateSettings(settings);
  }
}
