/**
 * N-gram Phrase Extraction Engine
 *
 * Extracts bi-grams and tri-grams from text to capture multi-word concepts
 * Examples: "machine learning", "neural network", "natural language processing"
 */

export interface NGram {
  phrase: string;        // The n-gram phrase
  frequency: number;     // How many times it appears
  positions: number[];   // Where it appears in the text
  type: 'bigram' | 'trigram';
}

export interface NGramResult {
  bigrams: Map<string, NGram>;
  trigrams: Map<string, NGram>;
  allNGrams: string[];   // All unique n-grams
}

/**
 * N-gram Engine for phrase extraction
 */
export class NGramEngine {
  private minFrequency: number;
  private stopwords: Set<string>;

  constructor(minFrequency: number = 2) {
    this.minFrequency = minFrequency;

    // Common English stopwords to filter out
    this.stopwords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
      'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
      'would', 'should', 'could', 'may', 'might', 'must', 'can', 'this',
      'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they'
    ]);
  }

  /**
   * Extract n-grams from text
   */
  extractNGrams(text: string): NGramResult {
    // Tokenize and normalize
    const tokens = this.tokenize(text);

    // Extract bi-grams
    const bigrams = this.extractBigrams(tokens);

    // Extract tri-grams
    const trigrams = this.extractTrigrams(tokens);

    // Combine all n-grams
    const allNGrams = [
      ...Array.from(bigrams.keys()),
      ...Array.from(trigrams.keys())
    ];

    return {
      bigrams,
      trigrams,
      allNGrams
    };
  }

  /**
   * Calculate Jaccard similarity between two sets of n-grams
   */
  calculateSimilarity(ngrams1: string[], ngrams2: string[]): number {
    if (ngrams1.length === 0 || ngrams2.length === 0) {
      return 0;
    }

    const set1 = new Set(ngrams1);
    const set2 = new Set(ngrams2);

    // Calculate intersection
    const intersection = new Set(
      [...set1].filter(x => set2.has(x))
    );

    // Calculate union
    const union = new Set([...set1, ...set2]);

    // Jaccard similarity = |intersection| / |union|
    return intersection.size / union.size;
  }

  /**
   * Tokenize text into words
   */
  private tokenize(text: string): string[] {
    // Convert to lowercase and split on word boundaries
    const words = text
      .toLowerCase()
      .replace(/[^\w\s-]/g, ' ')  // Remove punctuation except hyphens
      .split(/\s+/)
      .filter(word => word.length > 2);  // Filter out very short words

    return words;
  }

  /**
   * Extract bi-grams (2-word phrases)
   */
  private extractBigrams(tokens: string[]): Map<string, NGram> {
    const bigrams = new Map<string, NGram>();

    for (let i = 0; i < tokens.length - 1; i++) {
      const word1 = tokens[i];
      const word2 = tokens[i + 1];

      // Skip if either word is a stopword
      if (this.stopwords.has(word1) || this.stopwords.has(word2)) {
        continue;
      }

      const phrase = `${word1} ${word2}`;

      if (bigrams.has(phrase)) {
        const existing = bigrams.get(phrase)!;
        existing.frequency++;
        existing.positions.push(i);
      } else {
        bigrams.set(phrase, {
          phrase,
          frequency: 1,
          positions: [i],
          type: 'bigram'
        });
      }
    }

    // Filter by minimum frequency
    for (const [phrase, ngram] of bigrams.entries()) {
      if (ngram.frequency < this.minFrequency) {
        bigrams.delete(phrase);
      }
    }

    return bigrams;
  }

  /**
   * Extract tri-grams (3-word phrases)
   */
  private extractTrigrams(tokens: string[]): Map<string, NGram> {
    const trigrams = new Map<string, NGram>();

    for (let i = 0; i < tokens.length - 2; i++) {
      const word1 = tokens[i];
      const word2 = tokens[i + 1];
      const word3 = tokens[i + 2];

      // Skip if middle word is a stopword (allow first/last to be stopwords)
      if (this.stopwords.has(word2)) {
        continue;
      }

      const phrase = `${word1} ${word2} ${word3}`;

      if (trigrams.has(phrase)) {
        const existing = trigrams.get(phrase)!;
        existing.frequency++;
        existing.positions.push(i);
      } else {
        trigrams.set(phrase, {
          phrase,
          frequency: 1,
          positions: [i],
          type: 'trigram'
        });
      }
    }

    // Filter by minimum frequency
    for (const [phrase, ngram] of trigrams.entries()) {
      if (ngram.frequency < this.minFrequency) {
        trigrams.delete(phrase);
      }
    }

    return trigrams;
  }

  /**
   * Get statistics about n-grams
   */
  getStatistics(result: NGramResult): {
    totalBigrams: number;
    totalTrigrams: number;
    totalUnique: number;
    mostFrequentBigrams: NGram[];
    mostFrequentTrigrams: NGram[];
  } {
    const bigramArray = Array.from(result.bigrams.values());
    const trigramArray = Array.from(result.trigrams.values());

    // Sort by frequency
    const mostFrequentBigrams = bigramArray
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 10);

    const mostFrequentTrigrams = trigramArray
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 10);

    return {
      totalBigrams: result.bigrams.size,
      totalTrigrams: result.trigrams.size,
      totalUnique: result.allNGrams.length,
      mostFrequentBigrams,
      mostFrequentTrigrams
    };
  }
}
