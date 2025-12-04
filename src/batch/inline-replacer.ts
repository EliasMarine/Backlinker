/**
 * Inline Replacer for Batch Auto-Link
 *
 * Safely replaces keywords in markdown content with wikilinks,
 * avoiding protected zones like code blocks, frontmatter, and existing links.
 */

import { MatchReason } from '../types';

export interface SkippedRange {
  start: number;
  end: number;
  reason: 'frontmatter' | 'codeblock' | 'inlinecode' | 'wikilink' | 'mdlink' | 'url' | 'heading';
}

export interface Replacement {
  keyword: string;
  targetTitle: string;
  targetPath: string;
  position: number;
  length: number;
  originalText: string;
  replacementText: string;
  contextBefore: string;
  contextAfter: string;
  matchReason?: MatchReason;  // Why this keyword was matched (title, entity, phrase, keyword)
}

export interface ReplacementResult {
  originalContent: string;
  modifiedContent: string;
  replacements: Replacement[];
  skippedZones: SkippedRange[];
}

export interface KeywordToReplace {
  keyword: string;
  targetTitle: string;
  targetPath: string;
  confidence: number;
  matchReason?: MatchReason;  // Why this keyword was matched (title, entity, phrase, keyword)
}

/**
 * Find all protected zones in the content that should NOT be modified
 */
export function findProtectedZones(content: string): SkippedRange[] {
  const zones: SkippedRange[] = [];

  // 1. Frontmatter (must be at start of document)
  const frontmatterMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  if (frontmatterMatch) {
    zones.push({
      start: 0,
      end: frontmatterMatch[0].length,
      reason: 'frontmatter'
    });
  }

  // 2. Fenced code blocks (``` or ~~~)
  const codeBlockRegex = /(?:```|~~~)[\s\S]*?(?:```|~~~)/g;
  let match;
  while ((match = codeBlockRegex.exec(content)) !== null) {
    zones.push({
      start: match.index,
      end: match.index + match[0].length,
      reason: 'codeblock'
    });
  }

  // 3. Inline code (backticks, but not within code blocks)
  const inlineCodeRegex = /`[^`\n]+`/g;
  while ((match = inlineCodeRegex.exec(content)) !== null) {
    // Only add if not already inside a code block
    if (!isPositionInZones(match.index, zones)) {
      zones.push({
        start: match.index,
        end: match.index + match[0].length,
        reason: 'inlinecode'
      });
    }
  }

  // 4. Existing wikilinks [[...]] (including aliases [[note|alias]])
  const wikilinkRegex = /\[\[[^\]]+\]\]/g;
  while ((match = wikilinkRegex.exec(content)) !== null) {
    zones.push({
      start: match.index,
      end: match.index + match[0].length,
      reason: 'wikilink'
    });
  }

  // 5. Markdown links [text](url)
  const mdLinkRegex = /\[[^\]]*\]\([^)]+\)/g;
  while ((match = mdLinkRegex.exec(content)) !== null) {
    zones.push({
      start: match.index,
      end: match.index + match[0].length,
      reason: 'mdlink'
    });
  }

  // 6. URLs (http/https)
  const urlRegex = /https?:\/\/[^\s\)\]>]+/g;
  while ((match = urlRegex.exec(content)) !== null) {
    zones.push({
      start: match.index,
      end: match.index + match[0].length,
      reason: 'url'
    });
  }

  // 7. Headings (# lines) - avoid replacing in headings for cleaner output
  const headingRegex = /^#{1,6}\s+.*$/gm;
  while ((match = headingRegex.exec(content)) !== null) {
    zones.push({
      start: match.index,
      end: match.index + match[0].length,
      reason: 'heading'
    });
  }

  // Sort by start position for efficient lookup
  return zones.sort((a, b) => a.start - b.start);
}

/**
 * Check if a position falls within any protected zone
 */
function isPositionInZones(pos: number, zones: SkippedRange[]): boolean {
  for (const zone of zones) {
    if (pos >= zone.start && pos < zone.end) {
      return true;
    }
    if (zone.start > pos) break; // Early exit since zones are sorted
  }
  return false;
}

/**
 * Check if a range overlaps with any protected zone
 */
export function isRangeProtected(
  start: number,
  length: number,
  zones: SkippedRange[]
): boolean {
  const end = start + length;
  for (const zone of zones) {
    // Check for any overlap
    if (start < zone.end && end > zone.start) {
      return true;
    }
    if (zone.start >= end) break; // Early exit
  }
  return false;
}

/**
 * Build a regex for finding a keyword with word boundaries
 * Supports both exact matches and partial word matches for compound terms
 */
function buildKeywordRegex(keyword: string): RegExp {
  // Escape special regex characters
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Use word boundaries to match whole words only
  return new RegExp(`\\b${escaped}\\b`, 'gi');
}

/**
 * Extract context around a position for preview
 */
function extractContext(
  content: string,
  position: number,
  length: number,
  contextLength: number = 40
): { before: string; after: string } {
  const beforeStart = Math.max(0, position - contextLength);
  const afterEnd = Math.min(content.length, position + length + contextLength);

  let before = content.slice(beforeStart, position);
  let after = content.slice(position + length, afterEnd);

  // Clean up - trim to word boundaries and add ellipsis
  if (beforeStart > 0) {
    const spaceIdx = before.indexOf(' ');
    if (spaceIdx > 0 && spaceIdx < 10) {
      before = '...' + before.slice(spaceIdx + 1);
    } else {
      before = '...' + before;
    }
  }

  if (afterEnd < content.length) {
    const spaceIdx = after.lastIndexOf(' ');
    if (spaceIdx > after.length - 10 && spaceIdx > 0) {
      after = after.slice(0, spaceIdx) + '...';
    } else {
      after = after + '...';
    }
  }

  // Replace newlines with spaces for cleaner display
  before = before.replace(/\n/g, ' ');
  after = after.replace(/\n/g, ' ');

  return { before, after };
}

/**
 * Create a wikilink from target title, optionally with display text
 */
function createWikilink(targetTitle: string, displayText?: string): string {
  if (displayText && displayText.toLowerCase() !== targetTitle.toLowerCase()) {
    return `[[${targetTitle}|${displayText}]]`;
  }
  return `[[${targetTitle}]]`;
}

/**
 * Find all valid replacement positions for keywords in content
 * Only returns first occurrence per keyword (to avoid over-linking)
 */
export function findReplacements(
  content: string,
  keywords: KeywordToReplace[],
  protectedZones: SkippedRange[],
  maxReplacementsPerNote: number = 10
): Replacement[] {
  const replacements: Replacement[] = [];
  const usedKeywords = new Set<string>(); // Track which keywords we've already matched

  // Sort keywords by confidence (highest first) to prioritize better matches
  const sortedKeywords = [...keywords].sort((a, b) => b.confidence - a.confidence);

  for (const kw of sortedKeywords) {
    // Skip if we've hit the max
    if (replacements.length >= maxReplacementsPerNote) break;

    // Skip if we've already matched this keyword (case-insensitive)
    const keywordLower = kw.keyword.toLowerCase();
    if (usedKeywords.has(keywordLower)) continue;

    const regex = buildKeywordRegex(kw.keyword);
    let match;

    while ((match = regex.exec(content)) !== null) {
      const pos = match.index;
      const matchedText = match[0];

      // Skip if in protected zone
      if (isRangeProtected(pos, matchedText.length, protectedZones)) {
        continue;
      }

      // Found a valid replacement position
      usedKeywords.add(keywordLower);

      const { before, after } = extractContext(content, pos, matchedText.length);

      replacements.push({
        keyword: kw.keyword,
        targetTitle: kw.targetTitle,
        targetPath: kw.targetPath,
        position: pos,
        length: matchedText.length,
        originalText: matchedText,
        replacementText: createWikilink(kw.targetTitle, matchedText),
        contextBefore: before,
        contextAfter: after,
        matchReason: kw.matchReason
      });

      // Only replace first occurrence per keyword
      break;
    }
  }

  return replacements;
}

/**
 * Apply replacements to content
 * Applies from end to start to preserve positions
 */
export function applyReplacements(
  content: string,
  replacements: Replacement[]
): string {
  if (replacements.length === 0) return content;

  // Sort by position descending (apply from end to preserve positions)
  const sorted = [...replacements].sort((a, b) => b.position - a.position);

  let result = content;
  for (const r of sorted) {
    result =
      result.slice(0, r.position) +
      r.replacementText +
      result.slice(r.position + r.length);
  }

  return result;
}

/**
 * Main entry point: Process content and return replacement result
 */
export function processContent(
  content: string,
  keywords: KeywordToReplace[],
  maxReplacementsPerNote: number = 10
): ReplacementResult {
  const skippedZones = findProtectedZones(content);
  const replacements = findReplacements(
    content,
    keywords,
    skippedZones,
    maxReplacementsPerNote
  );
  const modifiedContent = applyReplacements(content, replacements);

  return {
    originalContent: content,
    modifiedContent,
    replacements,
    skippedZones
  };
}
