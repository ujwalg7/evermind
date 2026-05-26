import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { Config } from './types';

// Load .env from workspace or user home dir
dotenv.config();

const DEFAULT_VAULT_PATH = process.env.OBSIDIAN_VAULT_PATH || '';
const DEFAULT_ATTACHMENTS_SUBDIR = process.env.EVERMIND_ATTACHMENTS_SUBDIR || 'attachments/evermind';
const DEFAULT_THRESHOLD = parseFloat(process.env.EVERMIND_THRESHOLD || '0.6');
const DEFAULT_RUN_LLM = process.env.EVERMIND_LLM_SYNTHESIS === 'true';

export function loadConfig(): Config {
  let vaultPath = DEFAULT_VAULT_PATH;
  
  // If not set, let's try to search user's home directory or check current working dir
  if (!vaultPath) {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    // Look for a test vault or default location if it exists
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

  // Fallback to current working directory if all else fails
  if (!vaultPath) {
    vaultPath = process.cwd();
  }

  return {
    vaultPath: path.resolve(vaultPath),
    attachmentsSubdir: DEFAULT_ATTACHMENTS_SUBDIR,
    exaApiKey: process.env.EXA_API_KEY,
    geminiApiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
    fallbackThreshold: isNaN(DEFAULT_THRESHOLD) ? 0.6 : DEFAULT_THRESHOLD,
    runLlmSynthesis: DEFAULT_RUN_LLM
  };
}
