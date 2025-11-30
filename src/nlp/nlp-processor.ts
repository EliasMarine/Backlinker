/**
 * Natural Language Processing for text analysis
 */
export class NLPProcessor {
  private stopwords: Set<string>;

  constructor() {
    // Initialize stopwords set (English by default)
    // The stopword library provides removeStopwords function
    this.stopwords = new Set([
      'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any',
      'are', 'aren\'t', 'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below',
      'between', 'both', 'but', 'by', 'can\'t', 'cannot', 'could', 'couldn\'t', 'did',
      'didn\'t', 'do', 'does', 'doesn\'t', 'doing', 'don\'t', 'down', 'during', 'each',
      'few', 'for', 'from', 'further', 'had', 'hadn\'t', 'has', 'hasn\'t', 'have',
      'haven\'t', 'having', 'he', 'he\'d', 'he\'ll', 'he\'s', 'her', 'here', 'here\'s',
      'hers', 'herself', 'him', 'himself', 'his', 'how', 'how\'s', 'i', 'i\'d', 'i\'ll',
      'i\'m', 'i\'ve', 'if', 'in', 'into', 'is', 'isn\'t', 'it', 'it\'s', 'its', 'itself',
      'let\'s', 'me', 'more', 'most', 'mustn\'t', 'my', 'myself', 'no', 'nor', 'not', 'of',
      'off', 'on', 'once', 'only', 'or', 'other', 'ought', 'our', 'ours', 'ourselves',
      'out', 'over', 'own', 'same', 'shan\'t', 'she', 'she\'d', 'she\'ll', 'she\'s',
      'should', 'shouldn\'t', 'so', 'some', 'such', 'than', 'that', 'that\'s', 'the',
      'their', 'theirs', 'them', 'themselves', 'then', 'there', 'there\'s', 'these',
      'they', 'they\'d', 'they\'ll', 'they\'re', 'they\'ve', 'this', 'those', 'through',
      'to', 'too', 'under', 'until', 'up', 'very', 'was', 'wasn\'t', 'we', 'we\'d',
      'we\'ll', 'we\'re', 'we\'ve', 'were', 'weren\'t', 'what', 'what\'s', 'when',
      'when\'s', 'where', 'where\'s', 'which', 'while', 'who', 'who\'s', 'whom', 'why',
      'why\'s', 'with', 'won\'t', 'would', 'wouldn\'t', 'you', 'you\'d', 'you\'ll',
      'you\'re', 'you\'ve', 'your', 'yours', 'yourself', 'yourselves'
    ]);
  }

  /**
   * Extract top keywords from text
   */
  extractKeywords(text: string, topN: number = 20): string[] {
    // Tokenize and normalize
    const tokens = this.tokenize(text);

    // Remove stopwords
    const filteredTokens = tokens.filter(token =>
      !this.stopwords.has(token.toLowerCase()) && token.length > 2
    );

    // Calculate frequency
    const freq = this.getWordFrequency(filteredTokens.join(' '));

    // Sort by frequency and return top N
    const sortedWords = Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .map(([word]) => word);

    return sortedWords;
  }

  /**
   * Calculate word frequency in text
   */
  getWordFrequency(text: string): Map<string, number> {
    const tokens = this.tokenize(text);
    const freq = new Map<string, number>();

    for (const token of tokens) {
      const normalized = token.toLowerCase();

      // Skip stopwords and very short tokens
      if (this.stopwords.has(normalized) || token.length < 2) {
        continue;
      }

      freq.set(normalized, (freq.get(normalized) || 0) + 1);
    }

    return freq;
  }

  /**
   * Tokenize text into words
   */
  private tokenize(text: string): string[] {
    // Split on whitespace and punctuation, but preserve hyphenated words
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, ' ') // Remove punctuation except hyphens
      .split(/\s+/)
      .filter(token => token.length > 0);
  }

  /**
   * Calculate term frequency (normalized by document length)
   */
  calculateTF(term: string, document: string): number {
    const tokens = this.tokenize(document);
    const termCount = tokens.filter(t => t === term.toLowerCase()).length;
    return tokens.length > 0 ? termCount / tokens.length : 0;
  }

  /**
   * Normalize a word (lowercase, remove punctuation)
   */
  normalize(word: string): string {
    return word
      .toLowerCase()
      .replace(/[^\w-]/g, '')
      .trim();
  }

  /**
   * Check if a word is a stopword
   */
  isStopword(word: string): boolean {
    return this.stopwords.has(word.toLowerCase());
  }

  /**
   * Get all unique terms from text (excluding stopwords)
   */
  getUniqueTerms(text: string): Set<string> {
    const tokens = this.tokenize(text);
    const uniqueTerms = new Set<string>();

    for (const token of tokens) {
      if (!this.stopwords.has(token) && token.length > 2) {
        uniqueTerms.add(token);
      }
    }

    return uniqueTerms;
  }

  /**
   * Calculate Jaccard similarity between two texts (simple keyword overlap)
   */
  calculateJaccardSimilarity(text1: string, text2: string): number {
    const terms1 = this.getUniqueTerms(text1);
    const terms2 = this.getUniqueTerms(text2);

    const intersection = new Set([...terms1].filter(x => terms2.has(x)));
    const union = new Set([...terms1, ...terms2]);

    return union.size > 0 ? intersection.size / union.size : 0;
  }
}
