import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { Config } from './types';

// Load .env from workspace or user home dir
dotenv.config();

const DEFAULT_VAULT_PATH = process.env.OBSIDIAN_VAULT_PATH || '';
const DEFAULT_INBOX_SUBDIR = process.env.EVERMIND_INBOX_SUBDIR || 'inbox/raw';
const DEFAULT_ATTACHMENTS_SUBDIR = process.env.EVERMIND_ATTACHMENTS_SUBDIR || 'attachments/evermind';
const DEFAULT_THRESHOLD = parseFloat(process.env.EVERMIND_THRESHOLD || '0.6');
const DEFAULT_RUN_LLM = process.env.EVERMIND_LLM_SYNTHESIS === 'true';

// Local Ollama defaults
const DEFAULT_OLLAMA_HOST = process.env.EVERMIND_OLLAMA_HOST || 'http://localhost:11434';
const DEFAULT_OLLAMA_MODEL = process.env.EVERMIND_OLLAMA_MODEL || 'llama3';

export function loadConfig(): Config {
  let vaultPath = DEFAULT_VAULT_PATH;
  
  if (!vaultPath) {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const potentialPaths = [
      path.join(homeDir, 'Documents', 'Obsidian Vault'),
      path.join(homeDir, 'Obsidian'),
      path.join(process.cwd(), 'vault')
    ];
    for (const p of potentialPaths) {
      if (fs.existsSync(p)) {
        vaultPath = p;
        break;
      }
    }
  }

  if (!vaultPath) {
    vaultPath = process.cwd();
  }

  return {
    vaultPath: path.resolve(vaultPath),
    inboxSubdir: DEFAULT_INBOX_SUBDIR,
    attachmentsSubdir: DEFAULT_ATTACHMENTS_SUBDIR,
    geminiApiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
    ollamaHost: DEFAULT_OLLAMA_HOST,
    ollamaModel: DEFAULT_OLLAMA_MODEL,
    fallbackThreshold: isNaN(DEFAULT_THRESHOLD) ? 0.6 : DEFAULT_THRESHOLD,
    runLlmSynthesis: DEFAULT_RUN_LLM
  };
}
