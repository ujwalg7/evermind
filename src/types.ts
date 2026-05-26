export interface ImageInfo {
  originalUrl: string;
  localFilename?: string;
  localPath?: string; // Relative to Vault root or absolute
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
}

export interface Config {
  vaultPath: string; // Path to Obsidian Vault root
  attachmentsSubdir: string; // e.g., 'attachments/evermind'
  exaApiKey?: string;
  geminiApiKey?: string;
  fallbackThreshold: number; // Score below which we fallback (default: 0.6)
  runLlmSynthesis: boolean; // Whether to run Tier 6 LLM polish by default
}
