/**
 * Smart Keyword Matcher for Batch Auto-Link
 *
 * A content-based keyword matching system that:
 * 1. Uses shared phrases (2-3 words) as link anchors - most meaningful
 * 2. Falls back to shared keywords if no phrase matches
 * 3. Falls back to title-based matching if no shared terms found
 * 4. Filters out domain-generic terms that create noise
 * 5. Considers word uniqueness in the vault
 * 6. Optionally uses embeddings for context verification
 *
 * The three-tier matching strategy ensures we find meaningful links:
 * - Strategy 1: Shared phrases (highest quality)
 * - Strategy 2: Shared keywords (good quality)
 * - Strategy 3: Title in content (fallback for semantically similar notes)
 *
 * Philosophy: Links should connect semantically related notes. Shared content
 * is preferred, but title matching is a valid fallback when the hybrid scorer
 * has already determined the notes are related.
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
}

export const DEFAULT_SMART_MATCHER_CONFIG: SmartMatcherConfig = {
  minKeywordLength: 4,
  maxDocumentFrequencyPercent: 20, // Skip words appearing in >20% of notes
  enableContextVerification: true,
  minContextSimilarity: 0.4
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
 * Strip numbered prefix from a title
 * Handles patterns like: "00 - Title", "1 - Title", "2.1 - Title", "01.2.3 - Title"
 * Returns the title without the prefix, or the original if no prefix found
 *
 * Note: Requires space-dash-space to avoid matching dates like "2024-04-24"
 */
function stripNumberedPrefix(title: string): string {
  // Pattern: digits, optional dots/digits, followed by space-dash-space
  // Examples: "1 - ", "00 - ", "2.1 - ", "01.2.3 - "
  // Does NOT match: "2024-04-24" (no space before dash)
  const prefixPattern = /^[\d]+(?:\.[\d]+)*\s+-\s+/;
  const stripped = title.replace(prefixPattern, '');
  return stripped !== title ? stripped : title;
}

/**
 * Get all variants of a title for matching
 * Returns [originalTitle, normalizedTitle] where normalizedTitle has prefix stripped
 * If they're the same, returns just [originalTitle]
 */
function getTitleVariants(title: string): string[] {
  const normalized = stripNumberedPrefix(title);
  if (normalized !== title && normalized.length > 0) {
    return [title, normalized];
  }
  return [title];
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
  matchReason: 'shared_phrase' | 'shared_keyword' | 'title_match' | 'context_verified';
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

      // Get target note embedding (embeddingCache may be null)
      const targetEmbedding = this.embeddingCache?.get(targetNotePath);
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
   *
   * IMPORTANT: Only creates links when the TARGET note's title (or significant
   * parts of it) appear in the source content. This ensures semantic correctness:
   * - If "Presentation Layer" appears in a note, link it to "Presentation Layer.md"
   * - Do NOT link arbitrary shared keywords to unrelated notes
   *
   * The hybrid scorer has already determined these notes are related.
   * This method finds WHERE in the source to place the link.
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

    const results: KeywordToReplace[] = [];

    // =========================================================================
    // TITLE-BASED MATCHING ONLY
    // =========================================================================
    // We ONLY create links when the target note's title appears in the source.
    // This ensures semantic correctness - we're linking text that actually
    // refers to the target note, not arbitrary shared keywords.
    //
    // IMPORTANT: We do NOT link shared keywords between notes. For example:
    // - Source: "Session Layer.md" - talks about "Session Layer"
    // - Target: "Presentation Layer.md" - talks about "Presentation Layer"
    // - Shared keywords: "Layer", "Session", etc.
    // - WRONG: Link "Session Layer" text to "Presentation Layer" note
    // - RIGHT: Only link "Presentation Layer" text (if it appears) to that note
    // =========================================================================

    // CRITICAL: Skip if the target title contains the source title or vice versa
    // This prevents linking "Session Layer" to "Presentation Layer" when both
    // share common words. We only want to link exact title references.
    const sourceTitleLower = sourceTitle.toLowerCase();
    const targetTitleLower = targetTitle.toLowerCase();

    // Don't match if the titles are too similar (share significant words)
    const sourceWords = new Set(sourceTitleLower.split(/[\s\-_()]+/).filter(w => w.length > 3));
    const targetWords = new Set(targetTitleLower.split(/[\s\-_()]+/).filter(w => w.length > 3));
    const sharedWords = [...sourceWords].filter(w => targetWords.has(w));

    // If more than 50% of significant words are shared, skip (too similar, would create confusing links)
    const minWords = Math.min(sourceWords.size, targetWords.size);
    if (minWords > 0 && sharedWords.length / minWords > 0.5) {
      console.log(
        `[SmartKeywordMatcher] Skipping "${targetTitle}" - too similar to source "${sourceTitle}" (shared: ${sharedWords.join(', ')})`
      );
      return [];
    }

    // Strategy 1: FULL TITLE MATCH (highest confidence)
    const titleVariants = getTitleVariants(targetTitle);

    for (const variant of titleVariants) {
      // Try full title match
      if (textExistsInContent(variant, sourceContent)) {
        // Multi-word titles are generally safe even if individual words are common
        const confidence = hybridResult.finalScore * 0.9;

        results.push({
          keyword: variant,
          targetTitle,
          targetPath: targetNote.path,
          confidence
        });

        console.log(
          `[SmartKeywordMatcher] Matched full title "${variant}" -> "${targetTitle}" (confidence: ${confidence.toFixed(2)})`
        );
        break; // Found a title match, no need to continue
      }
    }

    // Strategy 2: PARTIAL TITLE MATCH (lower confidence)
    // Only if no full title match was found
    // Try to find significant unique words from the target title
    if (results.length === 0) {
      // Get words that are in target title but NOT in source title
      // This prevents linking shared words like "Layer"
      const uniqueTargetWords = targetTitle
        .split(/[\s\-_()]+/)
        .filter(word =>
          word.length >= 4 &&
          !this.isDomainStopword(word) &&
          !sourceTitleLower.includes(word.toLowerCase())
        );

      for (const word of uniqueTargetWords) {
        if (textExistsInContent(word, sourceContent)) {
          if (this.isValidKeyword(word)) {
            let confidence = hybridResult.finalScore * 0.6;

            // Context verification is especially important for single words
            if (
              this.config.enableContextVerification &&
              this.embeddingEngine?.isModelLoaded()
            ) {
              const contextSimilarity = await this.verifyContextWithEmbeddings(
                sourceContent,
                word,
                targetNote.path
              );

              if (contextSimilarity < this.config.minContextSimilarity) {
                console.log(
                  `[SmartKeywordMatcher] Skipping title word "${word}" -> "${targetTitle}" - context similarity too low (${contextSimilarity.toFixed(2)})`
                );
                continue;
              }

              confidence = confidence * (0.5 + contextSimilarity * 0.5);
            }

            results.push({
              keyword: word,
              targetTitle,
              targetPath: targetNote.path,
              confidence
            });

            console.log(
              `[SmartKeywordMatcher] Matched unique title word "${word}" -> "${targetTitle}" (confidence: ${confidence.toFixed(2)})`
            );
            break; // One match is enough
          }
        }
      }
    }

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
        // All matches are now title-based (full or partial)
        const firstKeyword = validKeywords[0].keyword;
        const targetTitle = getNoteTitleFromPath(result.note.path);
        const titleVariants = getTitleVariants(targetTitle);

        // Determine if it's a full title match or partial
        const isFullTitleMatch = titleVariants.some(
          v => normalize(v) === normalize(firstKeyword)
        );
        const matchReason: 'shared_phrase' | 'shared_keyword' | 'title_match' | 'context_verified' =
          isFullTitleMatch ? 'title_match' : 'context_verified';

        results.push({
          targetNote: result.note,
          keywords: validKeywords,
          totalConfidence: result.finalScore,
          matchReason
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
