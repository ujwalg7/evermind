import axios from 'axios';
import { GoogleGenAI } from '@google/genai';
import { CanonicalNote, Config } from './types';

interface SynthesisResult {
  summary: string[];
  whyItMatters: string;
  tags: string[];
}

/**
 * Attempts local note synthesis using Ollama
 */
async function synthesizeWithOllama(
  note: CanonicalNote,
  host: string,
  model: string
): Promise<SynthesisResult | null> {
  console.log(`[LLM Synthesis] Attempting local synthesis with Ollama (model: ${model})...`);
  
  const prompt = `You are a professional research assistant analyzing articles for a personal knowledge base (Obsidian).
Review the article content below and extract structural metadata:
1. **summary**: A list of 3 key takeaways (each 1 sentence).
2. **whyItMatters**: A 1-2 sentence statement explaining why this article is valuable or important.
3. **tags**: 3-5 lowercase, single-word tags or categories describing the core topics. Do not include "#" symbols.

Article Title: "${note.title}"
Article Content:
${note.contentMarkdown.substring(0, 10000)} // Cap at 10k to keep local processing fast

Respond strictly in JSON format matching this JSON schema:
{
  "summary": ["takeaway 1", "takeaway 2", "takeaway 3"],
  "whyItMatters": "explanation why it matters",
  "tags": ["tag1", "tag2", "tag3"]
}`;

  try {
    const response = await axios.post(`${host}/api/generate`, {
      model,
      prompt,
      format: 'json',
      stream: false
    }, {
      timeout: 30000 // 30 seconds timeout for local inference
    });

    if (response.data && response.data.response) {
      const parsed: SynthesisResult = JSON.parse(response.data.response.trim());
      return parsed;
    }
    return null;
  } catch (err: any) {
    console.warn(`[LLM Synthesis] Ollama execution failed: ${err.message}`);
    return null;
  }
}

/**
 * Attempts remote synthesis using Google Gemini API
 */
async function synthesizeWithGemini(
  note: CanonicalNote,
  apiKey: string
): Promise<SynthesisResult | null> {
  console.log('[LLM Synthesis] Attempting cloud synthesis with Gemini...');
  const ai = new GoogleGenAI({ apiKey });

  const prompt = `You are a professional research assistant analyzing articles for a personal knowledge base (Obsidian).
Review the article content below and extract the following:
1. **summary**: A list of 3 key takeaways (each 1 sentence).
2. **whyItMatters**: A 1-2 sentence statement explaining why this article is valuable or important.
3. **tags**: 3-5 lowercase, single-word tags or categories describing the core topics. Do not include "#" symbols.

Article Title: "${note.title}"
Article Content:
${note.contentMarkdown.substring(0, 20000)}

Respond strictly in JSON format matching this schema:
{
  "summary": string[],
  "whyItMatters": string,
  "tags": string[]
}`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json'
      }
    });

    if (response.text) {
      const parsed: SynthesisResult = JSON.parse(response.text.trim());
      return parsed;
    }
    return null;
  } catch (err: any) {
    console.warn(`[LLM Synthesis] Gemini execution failed: ${err.message}`);
    return null;
  }
}

/**
 * Main coordinator for Tier 6 Note Synthesis (Ollama local first, Gemini cloud fallback)
 */
export async function synthesizeNote(
  note: CanonicalNote,
  config: Config
): Promise<CanonicalNote & { synthesis?: SynthesisResult }> {
  let result: SynthesisResult | null = null;

  // 1. First try local Ollama (completely free)
  try {
    // Ping Ollama server first
    await axios.get(`${config.ollamaHost}/api/tags`, { timeout: 2000 });
    result = await synthesizeWithOllama(note, config.ollamaHost, config.ollamaModel);
  } catch {
    console.log('[LLM Synthesis] Local Ollama server is not running or unreachable.');
  }

  // 2. Fallback to Gemini if Ollama failed/was offline but API key is configured
  if (!result && config.geminiApiKey) {
    result = await synthesizeWithGemini(note, config.geminiApiKey);
  }

  if (result) {
    // Clean up tags
    if (result.tags) {
      result.tags = result.tags
        .map(t => t.toLowerCase().replace(/[^a-z0-9-]/g, '').trim())
        .filter(Boolean);
    }
    console.log('[LLM Synthesis] Successfully synthesized note metadata.');
    return {
      ...note,
      synthesis: result
    };
  }

  console.warn('[LLM Synthesis] Synthesis was skipped or failed. Outputting raw capture only.');
  return note;
}
