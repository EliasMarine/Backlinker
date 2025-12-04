// Import NLP libraries
import nlp from 'compromise';
// Natural.js doesn't have default export, use require
// eslint-disable-next-line @typescript-eslint/no-var-requires
const natural = require('natural');

/**
 * Named entities extracted from text
 */
export interface ExtractedEntities {
  people: string[];
  organizations: string[];
  places: string[];
  acronyms: string[];
  technical: string[];  // Technical terms (capitalized multi-word phrases)
}

/**
 * Natural Language Processing for text analysis
 * Enhanced with Named Entity Recognition (NER) and POS tagging
 */
export class NLPProcessor {
  private stopwords: Set<string>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private posTagger: any;

  constructor() {
    // Initialize POS tagger from natural.js
    const baseFolder = './node_modules/natural/lib/natural/brill_pos_tagger';
    const rulesFilename = `${baseFolder}/data/English/tr_from_posjs.txt`;
    const lexiconFilename = `${baseFolder}/data/English/lexicon_from_posjs.json`;
    const defaultCategory = 'NN';

    try {
      const lexicon = new natural.Lexicon(lexiconFilename, defaultCategory);
      const rules = new natural.RuleSet(rulesFilename);
      this.posTagger = new natural.BrillPOSTagger(lexicon, rules);
    } catch (e) {
      // Fallback: create a simple tagger if files not found (bundled environment)
      console.warn('[NLPProcessor] POS tagger data not found, using fallback');
      this.posTagger = null as any;
    }

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
   * Extract meaningful multi-word phrases (n-grams)
   * Finds 2-3 word phrases that appear multiple times in the text
   * Used for content-based link matching
   */
  extractPhrases(text: string, topN: number = 30): string[] {
    const words = this.tokenize(text);
    const phraseFreq = new Map<string, number>();

    // Extract 2-word and 3-word phrases
    for (let n = 2; n <= 3; n++) {
      for (let i = 0; i <= words.length - n; i++) {
        const phraseWords = words.slice(i, i + n);

        // Skip if any word is a stopword or too short
        const hasStopword = phraseWords.some(w =>
          this.stopwords.has(w) || w.length < 3
        );
        if (hasStopword) continue;

        const phraseStr = phraseWords.join(' ');
        phraseFreq.set(phraseStr, (phraseFreq.get(phraseStr) || 0) + 1);
      }
    }

    // Return top N by frequency, require minimum 2 occurrences
    return Array.from(phraseFreq.entries())
      .filter(([_, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .map(([phrase]) => phrase);
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

  /**
   * Extract named entities from text using compromise.js
   * Identifies people, organizations, places, acronyms, and technical terms
   */
  extractNamedEntities(text: string): ExtractedEntities {
    const doc = nlp(text);

    // Extract people (names)
    const people = doc.people().out('array') as string[];

    // Extract organizations
    const organizations = doc.organizations().out('array') as string[];

    // Extract places/locations
    const places = doc.places().out('array') as string[];

    // Extract acronyms (all caps words, 2-6 chars)
    const acronyms: string[] = [];
    const acronymRegex = /\b[A-Z]{2,6}\b/g;
    const acronymMatches = text.match(acronymRegex);
    if (acronymMatches) {
      // Deduplicate and filter common ones
      const commonAcronyms = new Set(['THE', 'AND', 'FOR', 'ARE', 'BUT', 'NOT', 'YOU', 'ALL']);
      acronymMatches.forEach(a => {
        if (!commonAcronyms.has(a) && !acronyms.includes(a)) {
          acronyms.push(a);
        }
      });
    }

    // Extract technical terms (capitalized multi-word phrases)
    // e.g., "Machine Learning", "Natural Language Processing"
    const technical: string[] = [];
    const technicalRegex = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g;
    const technicalMatches = text.match(technicalRegex);
    if (technicalMatches) {
      technicalMatches.forEach(t => {
        // Filter out common phrases that aren't technical
        const lowerT = t.toLowerCase();
        if (!this.isCommonPhrase(lowerT) && !technical.includes(t)) {
          technical.push(t);
        }
      });
    }

    return {
      people: this.deduplicateAndClean(people),
      organizations: this.deduplicateAndClean(organizations),
      places: this.deduplicateAndClean(places),
      acronyms: acronyms.slice(0, 20),  // Limit to top 20
      technical: technical.slice(0, 30)  // Limit to top 30
    };
  }

  /**
   * Extract noun phrases using POS tagging from natural.js
   * Finds compound nouns and noun phrases (NN, NNP, NNS, NNPS patterns)
   */
  extractNounPhrases(text: string): string[] {
    if (!this.posTagger) {
      // Fallback: use simple capitalized phrase extraction
      return this.extractCapitalizedPhrases(text);
    }

    try {
      const tokenizer = new natural.WordTokenizer();
      const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
      const nounPhrases: Map<string, number> = new Map();

      for (const sentence of sentences) {
        const tokens = tokenizer.tokenize(sentence);
        if (!tokens || tokens.length === 0) continue;

        const tagged = this.posTagger.tag(tokens);
        if (!tagged || !tagged.taggedWords) continue;

        // Find consecutive noun sequences (NN, NNP, NNS, NNPS, JJ+NN patterns)
        const nounTags = new Set(['NN', 'NNP', 'NNS', 'NNPS']);
        const adjectiveTags = new Set(['JJ', 'JJR', 'JJS']);

        let currentPhrase: string[] = [];

        for (const wordTag of tagged.taggedWords) {
          const { token, tag } = wordTag;

          if (nounTags.has(tag) || (adjectiveTags.has(tag) && currentPhrase.length === 0)) {
            currentPhrase.push(token);
          } else {
            if (currentPhrase.length >= 2) {
              const phrase = currentPhrase.join(' ');
              if (!this.isStopword(phrase) && phrase.length >= 4) {
                nounPhrases.set(phrase, (nounPhrases.get(phrase) || 0) + 1);
              }
            }
            currentPhrase = [];
          }
        }

        // Handle phrase at end of sentence
        if (currentPhrase.length >= 2) {
          const phrase = currentPhrase.join(' ');
          if (!this.isStopword(phrase) && phrase.length >= 4) {
            nounPhrases.set(phrase, (nounPhrases.get(phrase) || 0) + 1);
          }
        }
      }

      // Sort by frequency and return top phrases
      return Array.from(nounPhrases.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 50)
        .map(([phrase]) => phrase);
    } catch (e) {
      console.warn('[NLPProcessor] POS tagging failed, using fallback:', e);
      return this.extractCapitalizedPhrases(text);
    }
  }

  /**
   * Fallback: Extract capitalized phrases when POS tagger unavailable
   */
  private extractCapitalizedPhrases(text: string): string[] {
    const phrases: string[] = [];
    // Match 2-4 word capitalized phrases
    const regex = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/g;
    const matches = text.match(regex);

    if (matches) {
      const seen = new Set<string>();
      for (const match of matches) {
        const lower = match.toLowerCase();
        if (!seen.has(lower) && !this.isCommonPhrase(lower)) {
          seen.add(lower);
          phrases.push(match);
        }
      }
    }

    return phrases.slice(0, 50);
  }

  /**
   * Check if a phrase is too common to be meaningful
   */
  private isCommonPhrase(phrase: string): boolean {
    const commonPhrases = new Set([
      'the first', 'the last', 'the next', 'the same',
      'this is', 'that is', 'there are', 'there is',
      'it is', 'they are', 'we are', 'you are',
      'can be', 'will be', 'has been', 'have been',
      'for example', 'such as', 'as well', 'in order',
      'more than', 'less than', 'at least', 'at most'
    ]);
    return commonPhrases.has(phrase.toLowerCase());
  }

  /**
   * Deduplicate and clean entity list
   */
  private deduplicateAndClean(entities: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const entity of entities) {
      const cleaned = entity.trim();
      const lower = cleaned.toLowerCase();

      // Skip if already seen, too short, or is a stopword
      if (seen.has(lower) || cleaned.length < 2 || this.stopwords.has(lower)) {
        continue;
      }

      seen.add(lower);
      result.push(cleaned);
    }

    return result.slice(0, 30);  // Limit to 30 per category
  }

  /**
   * Get all entities as a flat array (for matching)
   */
  getAllEntitiesFlat(entities: ExtractedEntities): string[] {
    return [
      ...entities.people,
      ...entities.organizations,
      ...entities.places,
      ...entities.acronyms,
      ...entities.technical
    ];
  }
}
