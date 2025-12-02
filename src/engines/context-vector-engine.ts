/**
 * Context Co-occurrence Vector Engine
 *
 * Builds word association matrices from the user's vault
 * Words that appear together frequently become semantically similar
 *
 * Example: "python" and "javascript" might never appear in the same sentence,
 * but they both co-occur with words like "programming", "code", "function",
 * making them semantically related in the context vector space
 */

export interface CoOccurrence {
  word: string;
  count: number;
  score: number;  // Normalized co-occurrence score
}

export interface ContextVector {
  word: string;
  vector: Map<string, number>;  // Word -> co-occurrence score
  magnitude: number;             // Vector magnitude for normalization
}

export interface ContextVectorEngineStats {
  totalWords: number;
  totalVectors: number;
  avgVectorSize: number;
  mostConnectedWords: Array<{ word: string; connections: number }>;
}

/**
 * Context Vector Engine for learning semantic relationships from vault
 */
export class ContextVectorEngine {
  private contextVectors: Map<string, ContextVector>;
  private windowSize: number;
  private minOccurrences: number;

  constructor(windowSize: number = 5, minOccurrences: number = 2) {
    this.contextVectors = new Map();
    this.windowSize = windowSize;  // How many words before/after to consider
    this.minOccurrences = minOccurrences;  // Minimum times a word must appear
  }

  /**
   * Build context vectors from a collection of documents
   */
  buildFromDocuments(documents: Array<{ content: string; weight?: number }>): void {
    console.log('[ContextVector] Building context vectors from', documents.length, 'documents');

    // Step 1: Build co-occurrence matrix
    const coOccurrenceMatrix = this.buildCoOccurrenceMatrix(documents);

    // Step 2: Convert to context vectors
    this.contextVectors = this.buildContextVectors(coOccurrenceMatrix);

    console.log('[ContextVector] Built', this.contextVectors.size, 'context vectors');
  }

  /**
   * Calculate semantic similarity between two words
   */
  calculateSimilarity(word1: string, word2: string): number {
    const vector1 = this.contextVectors.get(word1.toLowerCase());
    const vector2 = this.contextVectors.get(word2.toLowerCase());

    if (!vector1 || !vector2) {
      return 0;
    }

    return this.cosineSimilarity(vector1, vector2);
  }

  /**
   * Find most similar words to a given word
   */
  findSimilarWords(word: string, topN: number = 10, minSimilarity: number = 0.1): Array<{ word: string; similarity: number }> {
    const targetWord = word.toLowerCase();
    const targetVector = this.contextVectors.get(targetWord);

    if (!targetVector) {
      return [];
    }

    const similarities: Array<{ word: string; similarity: number }> = [];

    for (const [candidateWord, candidateVector] of this.contextVectors.entries()) {
      if (candidateWord === targetWord) {
        continue;
      }

      const similarity = this.cosineSimilarity(targetVector, candidateVector);

      if (similarity >= minSimilarity) {
        similarities.push({ word: candidateWord, similarity });
      }
    }

    // Sort by similarity descending
    similarities.sort((a, b) => b.similarity - a.similarity);

    return similarities.slice(0, topN);
  }

  /**
   * Calculate similarity between two text snippets using context vectors
   */
  calculateTextSimilarity(text1: string, text2: string): number {
    const words1 = this.tokenize(text1);
    const words2 = this.tokenize(text2);

    if (words1.length === 0 || words2.length === 0) {
      return 0;
    }

    // Build aggregated vectors for each text
    const vector1 = this.aggregateContextVectors(words1);
    const vector2 = this.aggregateContextVectors(words2);

    return this.cosineSimilarity(vector1, vector2);
  }

  /**
   * Get context vector for a word
   */
  getContextVector(word: string): ContextVector | undefined {
    return this.contextVectors.get(word.toLowerCase());
  }

  /**
   * Get statistics about the context vectors
   */
  getStatistics(): ContextVectorEngineStats {
    const vectors = Array.from(this.contextVectors.values());

    const totalVectorSize = vectors.reduce((sum, v) => sum + v.vector.size, 0);
    const avgVectorSize = vectors.length > 0 ? totalVectorSize / vectors.length : 0;

    // Find most connected words
    const wordConnections = vectors
      .map(v => ({ word: v.word, connections: v.vector.size }))
      .sort((a, b) => b.connections - a.connections)
      .slice(0, 10);

    return {
      totalWords: this.contextVectors.size,
      totalVectors: vectors.length,
      avgVectorSize,
      mostConnectedWords: wordConnections
    };
  }

  /**
   * Build co-occurrence matrix from documents
   */
  private buildCoOccurrenceMatrix(
    documents: Array<{ content: string; weight?: number }>
  ): Map<string, Map<string, number>> {
    const matrix = new Map<string, Map<string, number>>();
    const wordCounts = new Map<string, number>();

    // Process each document
    for (const doc of documents) {
      const tokens = this.tokenize(doc.content);
      const weight = doc.weight || 1.0;

      // Count word frequencies
      for (const token of tokens) {
        wordCounts.set(token, (wordCounts.get(token) || 0) + 1);
      }

      // Build co-occurrence counts within sliding window
      for (let i = 0; i < tokens.length; i++) {
        const centerWord = tokens[i];

        // Look at surrounding words within window
        const start = Math.max(0, i - this.windowSize);
        const end = Math.min(tokens.length, i + this.windowSize + 1);

        for (let j = start; j < end; j++) {
          if (i === j) continue;  // Skip the word itself

          const contextWord = tokens[j];

          // Skip if same word
          if (centerWord === contextWord) continue;

          // Get or create row for center word
          if (!matrix.has(centerWord)) {
            matrix.set(centerWord, new Map());
          }

          const row = matrix.get(centerWord)!;

          // Increment co-occurrence count (with distance weighting)
          const distance = Math.abs(i - j);
          const distanceWeight = 1.0 / distance;  // Closer words have higher weight

          row.set(
            contextWord,
            (row.get(contextWord) || 0) + (weight * distanceWeight)
          );
        }
      }
    }

    // Filter out rare words
    const filteredMatrix = new Map<string, Map<string, number>>();

    for (const [word, row] of matrix.entries()) {
      const count = wordCounts.get(word) || 0;

      if (count >= this.minOccurrences) {
        filteredMatrix.set(word, row);
      }
    }

    return filteredMatrix;
  }

  /**
   * Convert co-occurrence matrix to context vectors
   */
  private buildContextVectors(
    matrix: Map<string, Map<string, number>>
  ): Map<string, ContextVector> {
    const vectors = new Map<string, ContextVector>();

    for (const [word, row] of matrix.entries()) {
      // Calculate magnitude for normalization
      let magnitude = 0;
      for (const value of row.values()) {
        magnitude += value * value;
      }
      magnitude = Math.sqrt(magnitude);

      // Normalize vector
      const normalizedVector = new Map<string, number>();
      for (const [contextWord, value] of row.entries()) {
        normalizedVector.set(contextWord, value / magnitude);
      }

      vectors.set(word, {
        word,
        vector: normalizedVector,
        magnitude
      });
    }

    return vectors;
  }

  /**
   * Calculate cosine similarity between two context vectors
   */
  private cosineSimilarity(v1: ContextVector, v2: ContextVector): number {
    let dotProduct = 0;

    // Calculate dot product (only for shared dimensions)
    for (const [word, value1] of v1.vector.entries()) {
      const value2 = v2.vector.get(word);
      if (value2 !== undefined) {
        dotProduct += value1 * value2;
      }
    }

    // Vectors are already normalized, so magnitude = 1
    // Cosine similarity = dot product / (magnitude1 * magnitude2) = dot product
    return dotProduct;
  }

  /**
   * Aggregate context vectors from multiple words into a single vector
   */
  private aggregateContextVectors(words: string[]): ContextVector {
    const aggregated = new Map<string, number>();

    for (const word of words) {
      const vector = this.contextVectors.get(word);
      if (!vector) continue;

      for (const [contextWord, value] of vector.vector.entries()) {
        aggregated.set(
          contextWord,
          (aggregated.get(contextWord) || 0) + value
        );
      }
    }

    // Normalize
    let magnitude = 0;
    for (const value of aggregated.values()) {
      magnitude += value * value;
    }
    magnitude = Math.sqrt(magnitude);

    const normalized = new Map<string, number>();
    for (const [word, value] of aggregated.entries()) {
      normalized.set(word, value / magnitude);
    }

    return {
      word: '<aggregated>',
      vector: normalized,
      magnitude
    };
  }

  /**
   * Tokenize text into words
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2);  // Filter short words
  }

  /**
   * Clear all context vectors
   */
  clear(): void {
    this.contextVectors.clear();
  }

  /**
   * Serialize context vectors for caching
   */
  serialize(): string {
    const data = {
      vectors: Array.from(this.contextVectors.entries()).map(([word, vector]) => ({
        word,
        vector: Array.from(vector.vector.entries()),
        magnitude: vector.magnitude
      })),
      windowSize: this.windowSize,
      minOccurrences: this.minOccurrences
    };

    return JSON.stringify(data);
  }

  /**
   * Deserialize context vectors from cached data
   */
  deserialize(data: string): void {
    const parsed = JSON.parse(data);

    this.windowSize = parsed.windowSize;
    this.minOccurrences = parsed.minOccurrences;

    this.contextVectors = new Map(
      parsed.vectors.map((item: any) => [
        item.word,
        {
          word: item.word,
          vector: new Map(item.vector),
          magnitude: item.magnitude
        }
      ])
    );
  }
}
