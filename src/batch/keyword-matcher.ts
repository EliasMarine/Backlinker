/**
 * Keyword Matcher for Batch Auto-Link
 *
 * Maps matched keywords from HybridScorer results to their corresponding
 * target note titles, handling various matching strategies.
 *
 * Key insight: We need to find occurrences of the TARGET note's title
 * (or parts of it) in the SOURCE note's content, not just rely on
 * TF-IDF matched keywords which are similarity indicators.
 */

import { NoteIndex } from '../types';
import { KeywordToReplace } from './inline-replacer';

export interface HybridResultForMatching {
  note: NoteIndex;
  tfidfScore: number;
  semanticScore?: number;
  finalScore: number;
  matchedKeywords: string[];
  matchedPhrases?: string[];
}

export interface MatchResult {
  targetNote: NoteIndex;
  keywords: KeywordToReplace[];
  totalConfidence: number;
}

/**
 * Extract the display title from a note path
 * e.g., "folder/My Note.md" -> "My Note"
 */
function getNoteTitleFromPath(path: string): string {
  const fileName = path.split('/').pop() || path;
  return fileName.replace(/\.md$/, '');
}

/**
 * Normalize a string for comparison (lowercase, trim whitespace)
 */
function normalize(str: string): string {
  return str.toLowerCase().trim();
}

/**
 * Check if a keyword matches or is related to a note's title
 * Returns a confidence score (0-1) based on match quality
 */
function getKeywordTitleMatchScore(keyword: string, noteTitle: string): number {
  const kwNorm = normalize(keyword);
  const titleNorm = normalize(noteTitle);

  // Exact match
  if (kwNorm === titleNorm) {
    return 1.0;
  }

  // Keyword is a prefix of the title (e.g., "Python" matches "Python Programming")
  if (titleNorm.startsWith(kwNorm + ' ')) {
    return 0.9;
  }

  // Title starts with keyword (e.g., "React" matches "React.js Tutorial")
  if (titleNorm.startsWith(kwNorm)) {
    return 0.85;
  }

  // Keyword is contained in title as a word
  const titleWords = titleNorm.split(/\s+/);
  if (titleWords.includes(kwNorm)) {
    return 0.8;
  }

  // Title contains keyword as substring
  if (titleNorm.includes(kwNorm)) {
    return 0.6;
  }

  // No match
  return 0;
}

/**
 * Check if a keyword matches any of the note's extracted keywords
 */
function getKeywordNoteKeywordsMatchScore(
  keyword: string,
  noteKeywords: string[]
): number {
  const kwNorm = normalize(keyword);

  for (const nkw of noteKeywords) {
    const nkwNorm = normalize(nkw);

    // Exact match
    if (kwNorm === nkwNorm) {
      return 0.7;
    }

    // One contains the other
    if (kwNorm.includes(nkwNorm) || nkwNorm.includes(kwNorm)) {
      return 0.5;
    }
  }

  return 0;
}

/**
 * Check if text exists in content (case-insensitive, word boundary)
 */
function textExistsInContent(text: string, content: string): boolean {
  if (!text || !content) return false;
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\b${escaped}\\b`, 'i');
  return regex.test(content);
}

/**
 * Find the best matching keyword for linking to a target note
 * Returns keywords that can be replaced with links to the target note
 *
 * NEW APPROACH: Instead of just relying on TF-IDF matched keywords,
 * we search for the target note's title (or parts of it) in the
 * source note's content. This is much more effective because:
 * 1. TF-IDF keywords are similarity indicators, not replacement candidates
 * 2. We need text that ACTUALLY EXISTS in the source content
 */
export function findKeywordsForNote(
  hybridResult: HybridResultForMatching,
  sourceNote: NoteIndex
): KeywordToReplace[] {
  const targetNote = hybridResult.note;

  // CRITICAL: Never link a note to itself
  if (targetNote.path === sourceNote.path) {
    return [];
  }

  const targetTitle = getNoteTitleFromPath(targetNote.path);
  const sourceContent = sourceNote.content || '';
  const results: KeywordToReplace[] = [];

  // Also skip if the source note's title matches the target title (same note, different path reference)
  const sourceTitle = getNoteTitleFromPath(sourceNote.path);
  if (sourceTitle.toLowerCase() === targetTitle.toLowerCase()) {
    return [];
  }

  // Strategy 1: Full title match in source content
  // This is the best case - the exact note title appears in the source
  if (textExistsInContent(targetTitle, sourceContent)) {
    results.push({
      keyword: targetTitle,
      targetTitle,
      targetPath: targetNote.path,
      confidence: hybridResult.finalScore * 1.0
    });
  }

  // Strategy 2: Title words that appear in source content
  // For multi-word titles like "Machine Learning", try matching individual words
  const titleWords = targetTitle.split(/\s+/);
  const commonWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of',
    'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have',
    'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
    'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used',
    'this', 'that', 'these', 'those', 'my', 'your', 'his', 'her', 'its',
    'our', 'their', 'what', 'which', 'who', 'whom', 'whose', 'how', 'when',
    'where', 'why', 'all', 'each', 'every', 'both', 'few', 'more', 'most',
    'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so',
    'than', 'too', 'very', 'just', 'also', 'now', 'here', 'there', 'then'
  ]);

  if (titleWords.length > 1) {
    for (const word of titleWords) {
      // Skip short words and common words
      if (word.length <= 3 || commonWords.has(word.toLowerCase())) {
        continue;
      }

      // Check if this word exists in source content
      if (textExistsInContent(word, sourceContent)) {
        results.push({
          keyword: word,
          targetTitle,
          targetPath: targetNote.path,
          confidence: hybridResult.finalScore * 0.7 // Lower confidence for partial match
        });
      }
    }
  }

  // Strategy 3: Target note's extracted keywords that exist in source content
  // These are significant terms from the target note
  if (targetNote.keywords && targetNote.keywords.length > 0) {
    for (const keyword of targetNote.keywords) {
      // Skip if too short
      if (keyword.length <= 3) continue;

      // Check if this keyword exists in source content
      if (textExistsInContent(keyword, sourceContent)) {
        // Check if keyword relates to title for higher confidence
        const titleScore = getKeywordTitleMatchScore(keyword, targetTitle);
        const confidence = titleScore > 0
          ? hybridResult.finalScore * 0.8
          : hybridResult.finalScore * 0.5;

        results.push({
          keyword,
          targetTitle,
          targetPath: targetNote.path,
          confidence
        });
      }
    }
  }

  // Strategy 4: TF-IDF matched keywords that also match the title
  // These are terms that appear in both notes AND relate to the target title
  if (hybridResult.matchedKeywords && hybridResult.matchedKeywords.length > 0) {
    for (const keyword of hybridResult.matchedKeywords) {
      // Only use if it matches the title AND exists in source content
      const titleScore = getKeywordTitleMatchScore(keyword, targetTitle);
      if (titleScore > 0 && textExistsInContent(keyword, sourceContent)) {
        results.push({
          keyword,
          targetTitle,
          targetPath: targetNote.path,
          confidence: hybridResult.finalScore * titleScore
        });
      }
    }
  }

  // Remove duplicates and sort by confidence
  const uniqueResults = deduplicateKeywords(results);
  return uniqueResults.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Remove duplicate keywords (case-insensitive)
 */
function deduplicateKeywords(keywords: KeywordToReplace[]): KeywordToReplace[] {
  const seen = new Map<string, KeywordToReplace>();

  for (const kw of keywords) {
    const key = normalize(kw.keyword);
    const existing = seen.get(key);

    // Keep the one with higher confidence
    if (!existing || kw.confidence > existing.confidence) {
      seen.set(key, kw);
    }
  }

  return Array.from(seen.values());
}

/**
 * Process multiple hybrid results and find all keywords that can be replaced
 * Returns keywords grouped by their target note
 */
export function processHybridResults(
  hybridResults: HybridResultForMatching[],
  sourceNote: NoteIndex,
  minConfidence: number = 0.3
): MatchResult[] {
  const results: MatchResult[] = [];

  for (const result of hybridResults) {
    // CRITICAL: Skip self-links
    if (result.note.path === sourceNote.path) {
      continue;
    }

    // Skip results below threshold
    if (result.finalScore < minConfidence) {
      continue;
    }

    const keywords = findKeywordsForNote(result, sourceNote);

    // Filter keywords below threshold
    const validKeywords = keywords.filter(k => k.confidence >= minConfidence);

    if (validKeywords.length > 0) {
      results.push({
        targetNote: result.note,
        keywords: validKeywords,
        totalConfidence: result.finalScore
      });
    }
  }

  // Sort by total confidence
  return results.sort((a, b) => b.totalConfidence - a.totalConfidence);
}

/**
 * Flatten match results into a single list of keywords to replace
 * Handles conflicts where multiple target notes want to claim the same keyword
 */
export function flattenToKeywords(
  matchResults: MatchResult[],
  maxPerNote: number = 10
): KeywordToReplace[] {
  const allKeywords: KeywordToReplace[] = [];
  const claimedKeywords = new Map<string, KeywordToReplace>();

  for (const result of matchResults) {
    for (const kw of result.keywords) {
      const key = normalize(kw.keyword);
      const existing = claimedKeywords.get(key);

      // If keyword already claimed, keep the higher confidence one
      if (!existing || kw.confidence > existing.confidence) {
        claimedKeywords.set(key, kw);
      }
    }
  }

  // Convert to array and limit
  const keywords = Array.from(claimedKeywords.values());
  keywords.sort((a, b) => b.confidence - a.confidence);

  return keywords.slice(0, maxPerNote);
}
