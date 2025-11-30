/**
 * Type definitions for Smart Links plugin
 */

/** Core note representation with all indexed data */
export interface NoteIndex {
  path: string;
  title: string;
  content: string;
  cleanContent: string; // stripped of markdown
  keywords: string[];
  existingLinks: LinkReference[];
  headings: string[];
  tags: string[];
  lastModified: number;

  // TF-IDF data (always computed)
  tfidfVector: Map<string, number>;
  wordFrequency: Map<string, number>;

  // Embedding data (computed on demand)
  embedding?: Float32Array; // 384-dim vector
  embeddingVersion?: string; // track which model version
}

/** Reference to a link within a note */
export interface LinkReference {
  targetPath: string;
  targetTitle: string;
  displayText?: string;
  lineNumber: number;
}

/** A suggested connection between two notes */
export interface LinkSuggestion {
  id: string; // unique identifier
  sourceNote: string;
  targetNote: string;

  // Scoring
  tfidfScore: number; // 0-1
  embeddingScore?: number; // 0-1 (null if embeddings disabled)
  finalScore: number; // combined/weighted score

  // Context
  matchedKeywords: string[];
  explanation: string;

  // Metadata
  status: 'pending' | 'accepted' | 'rejected' | 'applied';
  createdAt: number;
}

/** In-memory cache of all indexed notes */
export interface VaultCache {
  notes: Map<string, NoteIndex>;
  documentFrequency: Map<string, number>; // IDF calculation
  totalDocuments: number;
  lastFullAnalysis: number;
  embeddingsEnabled: boolean;
  version: string;
}

/** Serializable version of VaultCache for persistence */
export interface SerializedVaultCache {
  notes: Record<string, SerializedNoteIndex>;
  documentFrequency: Record<string, number>;
  totalDocuments: number;
  lastFullAnalysis: number;
  embeddingsEnabled: boolean;
  version: string;
}

/** Serializable version of NoteIndex */
export interface SerializedNoteIndex {
  path: string;
  title: string;
  content: string;
  cleanContent: string;
  keywords: string[];
  existingLinks: LinkReference[];
  headings: string[];
  tags: string[];
  lastModified: number;
  tfidfVector: Record<string, number>;
  wordFrequency: Record<string, number>;
  embeddingVersion?: string;
}

/** Result of parsing markdown content */
export interface ParsedContent {
  cleanText: string;
  links: LinkReference[];
  headings: string[];
  tags: string[];
  codeBlocks: string[];
}

/** Progress callback for long-running operations */
export type ProgressCallback = (progress: number, message?: string) => void;

/** Settings for the Smart Links plugin */
export interface SmartLinksSettings {
  // Analysis modes
  enableRealTimeSuggestions: boolean;
  enableEmbeddings: boolean;
  embeddingModel: 'sentence-transformers' | 'none';

  // Thresholds
  tfidfThreshold: number; // 0-1, default 0.3
  embeddingThreshold: number; // 0-1, default 0.6
  combinedThreshold: number; // 0-1, default 0.5

  // Weights for hybrid scoring
  tfidfWeight: number; // default 0.4
  embeddingWeight: number; // default 0.6

  // Performance
  maxSuggestionsPerNote: number; // default 10
  batchSize: number; // for vault analysis, default 50
  cacheEnabled: boolean;

  // Exclusions
  excludedFolders: string[];
  excludedTags: string[];
  minNoteLength: number; // ignore very short notes

  // Features
  showConfidenceScores: boolean;
  debounceDelay: number; // milliseconds, default 300

  // UI
  suggestionPanelPosition: 'right' | 'left';
  maxRealtimeSuggestions: number; // default 5
}

/** Default settings values */
export const DEFAULT_SETTINGS: SmartLinksSettings = {
  // Analysis modes
  enableRealTimeSuggestions: true,
  enableEmbeddings: false,
  embeddingModel: 'sentence-transformers',

  // Thresholds
  tfidfThreshold: 0.3,
  embeddingThreshold: 0.6,
  combinedThreshold: 0.5,

  // Weights
  tfidfWeight: 0.4,
  embeddingWeight: 0.6,

  // Performance
  maxSuggestionsPerNote: 10,
  batchSize: 50,
  cacheEnabled: true,

  // Exclusions
  excludedFolders: [],
  excludedTags: ['#draft', '#private'],
  minNoteLength: 50,

  // Features
  showConfidenceScores: true,
  debounceDelay: 300,

  // UI
  suggestionPanelPosition: 'right',
  maxRealtimeSuggestions: 5
};
