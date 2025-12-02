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

  // Semantic data (computed on demand)
  // Note: Semantic vectors are managed by SemanticEngine, not stored per-note
  semanticVersion?: string; // track which semantic model version
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
  targetTitle: string; // Display title of target note

  // Scoring
  tfidfScore: number; // 0-1
  semanticScore?: number; // 0-1 (null if semantic disabled)
  finalScore: number; // combined/weighted score

  // Context
  matchedKeywords: string[];
  matchedPhrases?: string[]; // Matched n-gram phrases
  explanation: string;
  contentPreview: string; // First ~150 chars of target note content
  targetFolder: string; // Folder path of target note
  targetTags: string[]; // Tags from target note

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
  semanticEnabled: boolean;
  version: string;
}

/** Serializable version of VaultCache for persistence */
export interface SerializedVaultCache {
  notes: Record<string, SerializedNoteIndex>;
  documentFrequency: Record<string, number>;
  totalDocuments: number;
  lastFullAnalysis: number;
  semanticEnabled: boolean;
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
  semanticVersion?: string;
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
  enableSemanticSearch: boolean; // N-gram + context vector semantic
  semanticModelVersion: string; // Track semantic model version

  // Neural embeddings (Phase 3)
  enableNeuralEmbeddings: boolean; // Use transformer-based embeddings
  neuralModelName: string; // Model to use (default: Xenova/all-MiniLM-L6-v2)
  embeddingBatchSize: number; // Notes to process at once

  // Thresholds
  tfidfThreshold: number; // 0-1, default 0.3
  semanticThreshold: number; // 0-1, default 0.3 (renamed from embeddingThreshold)
  combinedThreshold: number; // 0-1, default 0.4

  // Weights for hybrid scoring
  tfidfWeight: number; // default 0.6
  semanticWeight: number; // default 0.4 (renamed from embeddingWeight)

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
  enableSemanticSearch: true, // Enabled by default (reliable!)
  semanticModelVersion: '1.0.0',

  // Neural embeddings (opt-in, requires model download)
  enableNeuralEmbeddings: false, // Disabled by default
  neuralModelName: 'Xenova/all-MiniLM-L6-v2',
  embeddingBatchSize: 8,

  // Thresholds
  tfidfThreshold: 0.3,
  semanticThreshold: 0.3, // Lower threshold since semantic is reliable
  combinedThreshold: 0.4, // Slightly lower for better recall

  // Weights (favor TF-IDF slightly for speed)
  tfidfWeight: 0.6,
  semanticWeight: 0.4,

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
