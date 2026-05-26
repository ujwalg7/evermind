export interface ImageInfo {
  originalUrl: string;
  localFilename?: string;
  localPath?: string; // Relative to Vault root
  status: 'downloaded' | 'failed' | 'skipped';
}

export interface CanonicalNote {
  title: string;
  sourceUrl: string;
  author?: string;
  publishedDate?: string;
  heroImageUrl?: string;
  contentMarkdown: string;
  headings: string[];
  images: ImageInfo[];
  confidenceScore: number; // 0 to 1 indicating extraction quality
  captureStatus: 'complete' | 'partial' | 'needs_review';
  fingerprint: string; // SHA-256 hash of the contentMarkdown
  tierUsed?: number;
  extractionError?: string;
}

export interface Config {
  vaultPath: string; // Path to Obsidian Vault root
  inboxSubdir: string; // e.g. 'inbox/raw'
  attachmentsSubdir: string; // e.g., 'attachments/evermind'
  geminiApiKey?: string;
  ollamaHost: string; // defaults to http://localhost:11434
  ollamaModel: string; // defaults to llama3
  fallbackThreshold: number; // Score below which we fallback (default: 0.6)
  runLlmSynthesis: boolean; // Whether to run LLM polish (default: false)
}
