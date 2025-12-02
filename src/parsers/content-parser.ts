import { ParsedContent, LinkReference } from '../types';

/**
 * Parses markdown content and extracts structured information
 */
export class ContentParser {
  /**
   * Parse markdown content into structured data
   */
  parse(content: string, filePath: string): ParsedContent {
    return {
      cleanText: this.stripMarkdown(content),
      links: this.extractLinks(content, filePath),
      headings: this.extractHeadings(content),
      tags: this.extractTags(content),
      codeBlocks: this.extractCodeBlocks(content)
    };
  }

  /**
   * Remove markdown syntax and extract plain text
   */
  private stripMarkdown(content: string): string {
    let text = content;

    // Remove frontmatter (YAML between ---)
    text = text.replace(/^---\n[\s\S]*?\n---\n/m, '');

    // Remove code blocks
    text = text.replace(/```[\s\S]*?```/g, ' ');

    // Remove inline code
    text = text.replace(/`[^`]+`/g, ' ');

    // Remove images: ![alt](url)
    text = text.replace(/!\[([^\]]*)\]\([^\)]+\)/g, '$1');

    // Remove links but keep text: [text](url) -> text
    text = text.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');

    // Remove wikilinks but keep text: [[link|text]] -> text, [[link]] -> link
    text = text.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2');
    text = text.replace(/\[\[([^\]]+)\]\]/g, '$1');

    // Remove HTML tags
    text = text.replace(/<[^>]+>/g, ' ');

    // Remove bold/italic: **text** or *text* -> text
    text = text.replace(/\*\*([^\*]+)\*\*/g, '$1');
    text = text.replace(/\*([^\*]+)\*/g, '$1');
    text = text.replace(/__([^_]+)__/g, '$1');
    text = text.replace(/_([^_]+)_/g, '$1');

    // Remove strikethrough: ~~text~~ -> text
    text = text.replace(/~~([^~]+)~~/g, '$1');

    // Remove headings markers
    text = text.replace(/^#{1,6}\s+/gm, '');

    // Remove blockquotes
    text = text.replace(/^>\s+/gm, '');

    // Remove list markers
    text = text.replace(/^[\s]*[-*+]\s+/gm, '');
    text = text.replace(/^[\s]*\d+\.\s+/gm, '');

    // Remove horizontal rules
    text = text.replace(/^[\s]*[-*_]{3,}[\s]*$/gm, '');

    // Remove excessive whitespace
    text = text.replace(/\s+/g, ' ');

    return text.trim();
  }

  /**
   * Extract all wikilinks from content
   */
  private extractLinks(content: string, filePath: string): LinkReference[] {
    const links: LinkReference[] = [];
    const lines = content.split('\n');

    // Match [[link]] or [[link|display text]]
    const wikilinkRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

    lines.forEach((line, lineIndex) => {
      let match;
      while ((match = wikilinkRegex.exec(line)) !== null) {
        const targetTitle = match[1].trim();
        const displayText = match[2]?.trim();

        links.push({
          targetTitle: targetTitle,
          targetPath: '', // Will be resolved later by vault indexer
          displayText: displayText,
          lineNumber: lineIndex
        });
      }
    });

    return links;
  }

  /**
   * Extract all headings from content
   */
  private extractHeadings(content: string): string[] {
    const headings: string[] = [];
    const headingRegex = /^(#{1,6})\s+(.+)$/gm;

    let match;
    while ((match = headingRegex.exec(content)) !== null) {
      const headingText = match[2].trim();
      headings.push(headingText);
    }

    return headings;
  }

  /**
   * Extract all tags from content
   */
  private extractTags(content: string): string[] {
    const tags = new Set<string>();

    // Match #tag or #nested/tag
    const tagRegex = /#([a-zA-Z][\w/-]*)/g;

    let match;
    while ((match = tagRegex.exec(content)) !== null) {
      const tag = match[1];
      // Filter out hex color codes and other invalid tags
      if (!this.isInvalidTag(tag)) {
        tags.add('#' + tag);
      }
    }

    // Also check frontmatter for tags
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];

      // Match tags: [tag1, tag2] or tags: tag1, tag2
      const yamlTagsMatch = frontmatter.match(/tags:\s*\[([^\]]+)\]/);
      if (yamlTagsMatch) {
        const tagList = yamlTagsMatch[1].split(',').map(t => t.trim());
        tagList.forEach(tag => {
          if (tag && !this.isInvalidTag(tag.replace(/^#/, ''))) {
            tags.add(tag.startsWith('#') ? tag : '#' + tag);
          }
        });
      }
    }

    return Array.from(tags);
  }

  /**
   * Check if a tag is invalid (hex color, header ID, etc.)
   */
  private isInvalidTag(tag: string): boolean {
    // Hex color codes: 3 or 6 hex characters
    if (/^[0-9a-fA-F]{3}$/.test(tag) || /^[0-9a-fA-F]{6}$/.test(tag)) {
      return true;
    }

    // Too short to be meaningful
    if (tag.length < 2) {
      return true;
    }

    // Purely numeric (not a real tag)
    if (/^\d+$/.test(tag)) {
      return true;
    }

    return false;
  }

  /**
   * Extract code blocks (to exclude from analysis)
   */
  private extractCodeBlocks(content: string): string[] {
    const codeBlocks: string[] = [];
    const codeBlockRegex = /```[\s\S]*?```/g;

    let match;
    while ((match = codeBlockRegex.exec(content)) !== null) {
      codeBlocks.push(match[0]);
    }

    return codeBlocks;
  }

  /**
   * Get line number for a character position in text
   */
  getLineNumber(content: string, position: number): number {
    const lines = content.substring(0, position).split('\n');
    return lines.length - 1;
  }
}
