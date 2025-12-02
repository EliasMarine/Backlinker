import { NoteIndex, VaultCache } from '../types';

export interface TFIDFResult {
  note: NoteIndex;
  score: number;
  matchedKeywords: string[];
}

/**
 * TF-IDF based similarity engine
 */
export class TFIDFEngine {
  private cache: VaultCache;

  constructor(cache: VaultCache) {
    this.cache = cache;
  }

  /**
   * Calculate TF-IDF vector for a note
   */
  calculateTFIDFVector(note: NoteIndex): Map<string, number> {
    const tfidfVector = new Map<string, number>();
    const totalDocs = this.cache.totalDocuments;

    if (totalDocs === 0) {
      return tfidfVector;
    }

    // For each term in the note's word frequency
    for (const [term, termFreq] of note.wordFrequency.entries()) {
      // Calculate TF (term frequency in this document)
      const totalWords = Array.from(note.wordFrequency.values()).reduce((a, b) => a + b, 0);
      const tf = totalWords > 0 ? termFreq / totalWords : 0;

      // Calculate IDF (inverse document frequency)
      const docFreq = this.cache.documentFrequency.get(term) || 1;
      const idf = Math.log(totalDocs / docFreq);

      // TF-IDF score
      const tfidf = tf * idf;
      tfidfVector.set(term, tfidf);
    }

    return tfidfVector;
  }

  /**
   * Calculate cosine similarity between two TF-IDF vectors
   */
  calculateCosineSimilarity(
    vector1: Map<string, number>,
    vector2: Map<string, number>
  ): number {
    // Get all unique terms from both vectors
    const allTerms = new Set([...vector1.keys(), ...vector2.keys()]);

    let dotProduct = 0;
    let magnitude1 = 0;
    let magnitude2 = 0;

    for (const term of allTerms) {
      const val1 = vector1.get(term) || 0;
      const val2 = vector2.get(term) || 0;

      dotProduct += val1 * val2;
      magnitude1 += val1 * val1;
      magnitude2 += val2 * val2;
    }

    // Calculate magnitudes
    magnitude1 = Math.sqrt(magnitude1);
    magnitude2 = Math.sqrt(magnitude2);

    // Avoid division by zero
    if (magnitude1 === 0 || magnitude2 === 0) {
      return 0;
    }

    // Cosine similarity
    return dotProduct / (magnitude1 * magnitude2);
  }

  /**
   * Calculate similarity between two notes
   */
  calculateSimilarity(note1: NoteIndex, note2: NoteIndex): number {
    return this.calculateCosineSimilarity(note1.tfidfVector, note2.tfidfVector);
  }

  /**
   * Find similar notes to a given note
   */
  findSimilarNotes(
    sourceNote: NoteIndex,
    threshold: number = 0.3,
    maxResults: number = 10
  ): TFIDFResult[] {
    const results: TFIDFResult[] = [];

    for (const candidateNote of this.cache.notes.values()) {
      // Skip same note
      if (candidateNote.path === sourceNote.path) {
        continue;
      }

      // Skip if already linked
      if (this.hasExistingLink(sourceNote, candidateNote)) {
        continue;
      }

      // Calculate similarity
      const score = this.calculateSimilarity(sourceNote, candidateNote);

      // Diagnostic logging for non-trivial scores
      if (score > 0.01) {
        console.log('[Smart Links] Similarity:', {
          candidate: candidateNote.title,
          score: score.toFixed(4),
          threshold: threshold,
          passed: score >= threshold
        });
      }

      // Only include if above threshold
      if (score >= threshold) {
        const matchedKeywords = this.findMatchedKeywords(sourceNote, candidateNote);
        results.push({
          note: candidateNote,
          score,
          matchedKeywords
        });
      }
    }

    // Sort by score descending and limit results
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);
  }

  /**
   * Check if source note already links to target note
   */
  private hasExistingLink(source: NoteIndex, target: NoteIndex): boolean {
    return source.existingLinks.some(
      link =>
        link.targetPath === target.path ||
        link.targetTitle === target.title ||
        link.targetTitle === target.path
    );
  }

  /**
   * Find keywords that appear in both notes
   */
  private findMatchedKeywords(note1: NoteIndex, note2: NoteIndex): string[] {
    const keywords1 = new Set(note1.keywords);
    const keywords2 = new Set(note2.keywords);

    const matched: string[] = [];
    for (const keyword of keywords1) {
      if (keywords2.has(keyword)) {
        matched.push(keyword);
      }
    }

    return matched;
  }

  /**
   * Get a note by path from the cache
   */
  getNote(path: string): NoteIndex | undefined {
    return this.cache.notes.get(path);
  }

  /**
   * Calculate IDF (Inverse Document Frequency) for a term
   */
  calculateIDF(term: string): number {
    const totalDocs = this.cache.totalDocuments;
    const docFreq = this.cache.documentFrequency.get(term) || 1;

    if (totalDocs === 0) {
      return 0;
    }

    return Math.log(totalDocs / docFreq);
  }

  /**
   * Update document frequency for terms in a note
   */
  updateDocumentFrequency(note: NoteIndex, isAdding: boolean = true): void {
    const uniqueTerms = new Set(note.wordFrequency.keys());

    for (const term of uniqueTerms) {
      const currentFreq = this.cache.documentFrequency.get(term) || 0;

      if (isAdding) {
        this.cache.documentFrequency.set(term, currentFreq + 1);
      } else {
        // Removing note
        const newFreq = Math.max(0, currentFreq - 1);
        if (newFreq === 0) {
          this.cache.documentFrequency.delete(term);
        } else {
          this.cache.documentFrequency.set(term, newFreq);
        }
      }
    }
  }

  /**
   * Recalculate TF-IDF vectors for all notes in cache
   * Call this after building the complete document frequency map
   */
  recalculateAllVectors(): void {
    for (const note of this.cache.notes.values()) {
      note.tfidfVector = this.calculateTFIDFVector(note);
    }
  }

  /**
   * Get statistics about the TF-IDF index
   */
  getStatistics(): {
    totalDocuments: number;
    totalTerms: number;
    avgVectorSize: number;
    avgSimilarityScore: number;
  } {
    const totalDocuments = this.cache.totalDocuments;
    const totalTerms = this.cache.documentFrequency.size;

    let totalVectorSize = 0;
    let totalSimilarityScore = 0;
    let comparisonCount = 0;

    const notes = Array.from(this.cache.notes.values());

    // Calculate average vector size
    for (const note of notes) {
      totalVectorSize += note.tfidfVector.size;
    }

    // Sample similarity scores (limit to avoid O(n²) complexity)
    const sampleSize = Math.min(100, notes.length);
    for (let i = 0; i < sampleSize; i++) {
      for (let j = i + 1; j < sampleSize; j++) {
        totalSimilarityScore += this.calculateSimilarity(notes[i], notes[j]);
        comparisonCount++;
      }
    }

    return {
      totalDocuments,
      totalTerms,
      avgVectorSize: notes.length > 0 ? totalVectorSize / notes.length : 0,
      avgSimilarityScore: comparisonCount > 0 ? totalSimilarityScore / comparisonCount : 0
    };
  }
}
