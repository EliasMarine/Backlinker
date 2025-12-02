/**
 * Smart Keyword Matcher for Batch Auto-Link
 *
 * A more intelligent keyword matching system that:
 * 1. Only matches meaningful references (primarily full note titles)
 * 2. Filters out domain-generic terms that create noise
 * 3. Considers word uniqueness in the vault
 * 4. Optionally uses embeddings for context verification
 *
 * Philosophy: It's better to miss some potential links than to create
 * incorrect ones. Users trust auto-linking to be accurate.
 */

import { NoteIndex, VaultCache } from '../types';
import { KeywordToReplace } from './inline-replacer';
import { EmbeddingEngine } from '../engines/embedding-engine';
import { EmbeddingCache } from '../cache/embedding-cache';

export interface SmartMatcherConfig {
  // Minimum length for a keyword to be considered
  minKeywordLength: number;

  // Maximum percentage of notes a word can appear in before being considered "generic"
  maxDocumentFrequencyPercent: number;

  // Enable context verification using embeddings
  enableContextVerification: boolean;

  // Minimum context similarity score (0-1) for embedding-based verification
  minContextSimilarity: number;

  // Only match exact titles (strictest mode)
  exactTitleMatchOnly: boolean;
}

export const DEFAULT_SMART_MATCHER_CONFIG: SmartMatcherConfig = {
  minKeywordLength: 4,
  maxDocumentFrequencyPercent: 20, // Skip words appearing in >20% of notes
  enableContextVerification: true,
  minContextSimilarity: 0.4,
  exactTitleMatchOnly: false
};

/**
 * Domain-generic stopwords that should never be used as link anchors
 * These are terms that appear frequently in technical/note-taking contexts
 * but don't represent meaningful references to specific notes
 */
const DOMAIN_STOPWORDS = new Set([
  // Common words that appear everywhere
  'data', 'information', 'system', 'process', 'method', 'function',
  'layer', 'level', 'type', 'kind', 'form', 'format', 'mode',
  'state', 'status', 'value', 'result', 'output', 'input',
  'user', 'client', 'server', 'service', 'application',
  'file', 'folder', 'document', 'page', 'section', 'part',
  'time', 'date', 'day', 'week', 'month', 'year',
  'name', 'title', 'label', 'description', 'content', 'text',
  'list', 'array', 'object', 'item', 'element', 'component',
  'start', 'end', 'begin', 'finish', 'complete', 'done',
  'new', 'old', 'current', 'previous', 'next', 'first', 'last',
  'main', 'primary', 'secondary', 'default', 'custom',
  'true', 'false', 'null', 'undefined', 'none', 'empty',
  'error', 'warning', 'message', 'response', 'request',
  'connection', 'link', 'reference', 'source', 'target',
  'number', 'count', 'total', 'size', 'length', 'width', 'height',
  'key', 'id', 'code', 'string', 'integer', 'boolean',
  'example', 'sample', 'test', 'demo', 'case', 'scenario',
  'note', 'notes', 'todo', 'task', 'action', 'step',
  'issue', 'problem', 'solution', 'answer', 'question',
  'point', 'line', 'block', 'area', 'region', 'zone',
  'option', 'setting', 'config', 'configuration', 'parameter',
  'feature', 'capability', 'ability', 'functionality',
  'protocol', 'interface', 'implementation', 'specification',
  'model', 'view', 'controller', 'handler', 'manager',
  'create', 'read', 'update', 'delete', 'add', 'remove',
  'get', 'set', 'put', 'post', 'send', 'receive',
  'open', 'close', 'load', 'save', 'import', 'export',
  'enable', 'disable', 'activate', 'deactivate',
  'show', 'hide', 'display', 'render', 'present',
  'network', 'internet', 'web', 'http', 'https',
  'security', 'encryption', 'authentication', 'authorization',
  'access', 'permission', 'role', 'policy',
  'session', 'cookie', 'token', 'credential',
  'address', 'port', 'host', 'domain', 'path', 'route',
  'packet', 'frame', 'segment', 'datagram', 'payload',
  'transmission', 'transfer', 'delivery', 'routing',
  'control', 'management', 'monitoring', 'logging',
  'analysis', 'processing', 'handling', 'operation',
  'used', 'using', 'like', 'such', 'also', 'well',
  'responsible', 'ensure', 'provide', 'include', 'contain',
  'layer', 'presentation', 'transport', 'physical', // OSI generic terms
  'compressed', 'compression', 'encrypted', 'transmitted',

  // Single-character and very short
  'a', 'an', 'the', 'is', 'it', 'to', 'of', 'in', 'on', 'at', 'by', 'for',
  'and', 'or', 'but', 'not', 'no', 'yes', 'all', 'any', 'some', 'each',
  'this', 'that', 'these', 'those', 'what', 'which', 'who', 'how', 'when',
  'where', 'why', 'can', 'may', 'will', 'shall', 'should', 'would', 'could',
  'must', 'need', 'have', 'has', 'had', 'do', 'does', 'did', 'done',
  'be', 'been', 'being', 'are', 'was', 'were', 'am',
  'get', 'got', 'give', 'gave', 'take', 'took', 'make', 'made',
  'see', 'saw', 'know', 'knew', 'think', 'thought', 'want', 'wanted',
  'use', 'used', 'using', 'work', 'works', 'working'
]);

/**
 * Extract the display title from a note path
 */
function getNoteTitleFromPath(path: string): string {
  const fileName = path.split('/').pop() || path;
  return fileName.replace(/\.md$/, '');
}

/**
 * Normalize a string for comparison
 */
function normalize(str: string): string {
  return str.toLowerCase().trim();
}

/**
 * Check if text exists in content as a whole word (case-insensitive)
 */
function textExistsInContent(text: string, content: string): boolean {
  if (!text || !content) return false;
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\b${escaped}\\b`, 'i');
  return regex.test(content);
}

/**
 * Extract the sentence containing a keyword for context analysis
 */
function extractSentenceContext(content: string, keyword: string): string | null {
  if (!content || !keyword) return null;

  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\b${escaped}\\b`, 'gi');

  const match = regex.exec(content);
  if (!match) return null;

  const matchIndex = match.index;

  // Find sentence boundaries
  const beforeText = content.slice(0, matchIndex);
  const afterText = content.slice(matchIndex);

  // Find start of sentence (look for period, newline, or start of text)
  let sentenceStart = beforeText.lastIndexOf('. ');
  if (sentenceStart === -1) sentenceStart = beforeText.lastIndexOf('\n');
  if (sentenceStart === -1) sentenceStart = 0;
  else sentenceStart += 2; // Skip the period/newline and space

  // Find end of sentence
  let sentenceEnd = afterText.indexOf('. ');
  if (sentenceEnd === -1) sentenceEnd = afterText.indexOf('\n');
  if (sentenceEnd === -1) sentenceEnd = afterText.length;

  const sentence = content.slice(sentenceStart, matchIndex + sentenceEnd).trim();

  // Return a reasonable context window (max 500 chars)
  if (sentence.length > 500) {
    // Center the keyword in the window
    const keywordPosInSentence = matchIndex - sentenceStart;
    const windowStart = Math.max(0, keywordPosInSentence - 200);
    const windowEnd = Math.min(sentence.length, keywordPosInSentence + keyword.length + 200);
    return sentence.slice(windowStart, windowEnd);
  }

  return sentence;
}

export interface HybridResultForSmartMatching {
  note: NoteIndex;
  tfidfScore: number;
  semanticScore?: number;
  finalScore: number;
  matchedKeywords: string[];
  matchedPhrases?: string[];
}

export interface SmartMatchResult {
  targetNote: NoteIndex;
  keywords: KeywordToReplace[];
  totalConfidence: number;
  matchReason: 'exact_title' | 'partial_title' | 'alias' | 'context_verified';
}

/**
 * Smart Keyword Matcher
 * Uses stricter matching criteria and optional context verification
 */
export class SmartKeywordMatcher {
  private config: SmartMatcherConfig;
  private cache: VaultCache;
  private embeddingEngine: EmbeddingEngine | null;
  private embeddingCache: EmbeddingCache | null;

  // Pre-computed word document frequencies
  private wordDocFrequency: Map<string, number> = new Map();
  private totalDocuments: number = 0;

  constructor(
    cache: VaultCache,
    config: Partial<SmartMatcherConfig> = {},
    embeddingEngine?: EmbeddingEngine | null,
    embeddingCache?: EmbeddingCache | null
  ) {
    this.config = { ...DEFAULT_SMART_MATCHER_CONFIG, ...config };
    this.cache = cache;
    this.embeddingEngine = embeddingEngine || null;
    this.embeddingCache = embeddingCache || null;

    this.computeWordFrequencies();
  }

  /**
   * Pre-compute word document frequencies for the vault
   */
  private computeWordFrequencies(): void {
    this.totalDocuments = this.cache.notes.size;

    if (this.totalDocuments === 0) return;

    // Use the cache's document frequency if available
    if (this.cache.documentFrequency.size > 0) {
      for (const [word, freq] of this.cache.documentFrequency.entries()) {
        this.wordDocFrequency.set(normalize(word), freq);
      }
      return;
    }

    // Otherwise compute from notes
    const wordDocs = new Map<string, Set<string>>();

    for (const [path, note] of this.cache.notes.entries()) {
      const words = (note.cleanContent || note.content || '')
        .toLowerCase()
        .split(/\W+/)
        .filter(w => w.length >= 3);

      for (const word of words) {
        if (!wordDocs.has(word)) {
          wordDocs.set(word, new Set());
        }
        wordDocs.get(word)!.add(path);
      }
    }

    for (const [word, docs] of wordDocs.entries()) {
      this.wordDocFrequency.set(word, docs.size);
    }
  }

  /**
   * Check if a word is too common in the vault to be meaningful
   */
  private isWordTooCommon(word: string): boolean {
    const normalizedWord = normalize(word);
    const docFreq = this.wordDocFrequency.get(normalizedWord) || 0;
    const freqPercent = (docFreq / Math.max(this.totalDocuments, 1)) * 100;

    return freqPercent > this.config.maxDocumentFrequencyPercent;
  }

  /**
   * Check if a word is a domain stopword
   */
  private isDomainStopword(word: string): boolean {
    return DOMAIN_STOPWORDS.has(normalize(word));
  }

  /**
   * Check if a keyword is valid for linking
   */
  private isValidKeyword(keyword: string): boolean {
    const normalized = normalize(keyword);

    // Too short
    if (normalized.length < this.config.minKeywordLength) {
      return false;
    }

    // Is a domain stopword
    if (this.isDomainStopword(normalized)) {
      return false;
    }

    // Too common in vault (skip single-word checks for multi-word titles)
    if (!keyword.includes(' ') && this.isWordTooCommon(normalized)) {
      return false;
    }

    return true;
  }

  /**
   * Verify context using embeddings
   * Returns similarity score between the sentence containing the keyword
   * and the target note's content
   */
  private async verifyContextWithEmbeddings(
    sourceContent: string,
    keyword: string,
    targetNotePath: string
  ): Promise<number> {
    if (!this.embeddingEngine?.isModelLoaded() || !this.embeddingCache) {
      return 1.0; // Skip verification if embeddings not available
    }

    try {
      // Extract the sentence containing the keyword
      const sentenceContext = extractSentenceContext(sourceContent, keyword);
      if (!sentenceContext || sentenceContext.length < 20) {
        return 0.5; // Neutral score if context too short
      }

      // Generate embedding for the sentence
      const sentenceEmbedding = await this.embeddingEngine.generateEmbedding(sentenceContext);

      // Get target note embedding
      const targetEmbedding = this.embeddingCache.get(targetNotePath);
      if (!targetEmbedding) {
        return 0.5; // Neutral score if target embedding not available
      }

      // Calculate similarity
      const similarity = this.embeddingEngine.cosineSimilarity(sentenceEmbedding, targetEmbedding);

      return similarity;
    } catch (error) {
      console.warn('[SmartKeywordMatcher] Context verification failed:', error);
      return 0.5;
    }
  }

  /**
   * Find keywords for a single note match
   * Uses strict matching criteria
   */
  async findKeywordsForNote(
    hybridResult: HybridResultForSmartMatching,
    sourceNote: NoteIndex
  ): Promise<KeywordToReplace[]> {
    const targetNote = hybridResult.note;

    // CRITICAL: Never link a note to itself
    if (targetNote.path === sourceNote.path) {
      return [];
    }

    const targetTitle = getNoteTitleFromPath(targetNote.path);
    const sourceContent = sourceNote.content || '';
    const sourceTitle = getNoteTitleFromPath(sourceNote.path);

    // Skip if same title (could be in different folders)
    if (normalize(sourceTitle) === normalize(targetTitle)) {
      return [];
    }

    const results: KeywordToReplace[] = [];

    // Strategy 1: EXACT full title match (highest confidence)
    // This is the most reliable - the note's exact title appears in the source
    if (textExistsInContent(targetTitle, sourceContent)) {
      // Even for exact matches, verify it's not a domain stopword
      if (this.isValidKeyword(targetTitle)) {
        let confidence = hybridResult.finalScore * 1.0;
        let matchReason: 'exact_title' | 'context_verified' = 'exact_title';

        // Optional context verification for single-word titles
        if (
          this.config.enableContextVerification &&
          !targetTitle.includes(' ') &&
          this.embeddingEngine?.isModelLoaded()
        ) {
          const contextSimilarity = await this.verifyContextWithEmbeddings(
            sourceContent,
            targetTitle,
            targetNote.path
          );

          if (contextSimilarity < this.config.minContextSimilarity) {
            // Context doesn't support this link - skip it
            console.log(
              `[SmartKeywordMatcher] Skipping "${targetTitle}" - context similarity too low (${contextSimilarity.toFixed(2)})`
            );
            return results;
          }

          confidence = confidence * (0.5 + contextSimilarity * 0.5);
          matchReason = 'context_verified';
        }

        results.push({
          keyword: targetTitle,
          targetTitle,
          targetPath: targetNote.path,
          confidence
        });

        console.log(
          `[SmartKeywordMatcher] Matched "${targetTitle}" via ${matchReason} (confidence: ${confidence.toFixed(2)})`
        );
      }
    }

    // If exact title match only mode, stop here
    if (this.config.exactTitleMatchOnly) {
      return results;
    }

    // Strategy 2: Multi-word title partial match
    // For titles like "Machine Learning Basics", check if "Machine Learning" appears
    const titleWords = targetTitle.split(/\s+/);
    if (titleWords.length >= 2 && results.length === 0) {
      // Try matching consecutive word combinations (2+ words)
      for (let i = 0; i < titleWords.length - 1; i++) {
        for (let j = i + 2; j <= titleWords.length; j++) {
          const phrase = titleWords.slice(i, j).join(' ');

          if (phrase.length >= 6 && textExistsInContent(phrase, sourceContent)) {
            // Multi-word phrase found
            const confidence = hybridResult.finalScore * 0.8 * (j - i) / titleWords.length;

            results.push({
              keyword: phrase,
              targetTitle,
              targetPath: targetNote.path,
              confidence
            });

            console.log(
              `[SmartKeywordMatcher] Matched phrase "${phrase}" -> "${targetTitle}" (confidence: ${confidence.toFixed(2)})`
            );

            // Only take the longest matching phrase
            break;
          }
        }
      }
    }

    // Strategy 3: Note aliases (if available in frontmatter)
    // This would require parsing YAML frontmatter - future enhancement

    // Remove duplicates, keep highest confidence
    const uniqueResults = new Map<string, KeywordToReplace>();
    for (const result of results) {
      const key = normalize(result.keyword);
      const existing = uniqueResults.get(key);
      if (!existing || result.confidence > existing.confidence) {
        uniqueResults.set(key, result);
      }
    }

    return Array.from(uniqueResults.values()).sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Process multiple hybrid results and find all valid keywords
   */
  async processHybridResults(
    hybridResults: HybridResultForSmartMatching[],
    sourceNote: NoteIndex,
    minConfidence: number = 0.3
  ): Promise<SmartMatchResult[]> {
    const results: SmartMatchResult[] = [];

    for (const result of hybridResults) {
      // Skip self-links
      if (result.note.path === sourceNote.path) {
        continue;
      }

      // Skip low-scoring results
      if (result.finalScore < minConfidence) {
        continue;
      }

      const keywords = await this.findKeywordsForNote(result, sourceNote);

      // Filter keywords below confidence threshold
      const validKeywords = keywords.filter(k => k.confidence >= minConfidence);

      if (validKeywords.length > 0) {
        results.push({
          targetNote: result.note,
          keywords: validKeywords,
          totalConfidence: result.finalScore,
          matchReason: validKeywords[0].keyword === getNoteTitleFromPath(result.note.path)
            ? 'exact_title'
            : 'partial_title'
        });
      }
    }

    return results.sort((a, b) => b.totalConfidence - a.totalConfidence);
  }

  /**
   * Flatten results to a single keyword list, handling conflicts
   */
  flattenToKeywords(
    matchResults: SmartMatchResult[],
    maxPerNote: number = 5
  ): KeywordToReplace[] {
    const claimedKeywords = new Map<string, KeywordToReplace>();

    for (const result of matchResults) {
      for (const kw of result.keywords) {
        const key = normalize(kw.keyword);
        const existing = claimedKeywords.get(key);

        // Keep higher confidence match
        if (!existing || kw.confidence > existing.confidence) {
          claimedKeywords.set(key, kw);
        }
      }
    }

    const keywords = Array.from(claimedKeywords.values());
    keywords.sort((a, b) => b.confidence - a.confidence);

    return keywords.slice(0, maxPerNote);
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SmartMatcherConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): SmartMatcherConfig {
    return { ...this.config };
  }

  /**
   * Get statistics about word frequencies
   */
  getStats(): {
    totalDocuments: number;
    uniqueWords: number;
    domainStopwords: number;
  } {
    return {
      totalDocuments: this.totalDocuments,
      uniqueWords: this.wordDocFrequency.size,
      domainStopwords: DOMAIN_STOPWORDS.size
    };
  }
}
