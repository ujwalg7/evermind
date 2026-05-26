import { GoogleGenAI } from '@google/genai';
import { CanonicalNote } from './types';

interface SynthesisResult {
  summary: string[];
  whyItMatters: string;
  tags: string[];
}

/**
 * Uses Gemini API to generate structured takeaways and metadata for an article
 */
export async function synthesizeNote(
  note: CanonicalNote,
  apiKey: string
): Promise<CanonicalNote & { synthesis?: SynthesisResult }> {
  console.log('[LLM Synthesis] Generating summary and tags with Gemini...');
  const ai = new GoogleGenAI({ apiKey });

  const prompt = `You are a professional research assistant analyzing articles for a personal knowledge base (Obsidian).
Review the article content below and extract the following:
1. **summary**: A bulleted list of 3 key takeaways (each 1 sentence).
2. **whyItMatters**: A 1-2 sentence statement explaining why this article is valuable or important.
3. **tags**: 3-5 lowercase, single-word tags or categories describing the core topics. Do not include "#" symbols.

Article Title: "${note.title}"
Article Content:
${note.contentMarkdown.substring(0, 30000)} // Cap at 30k characters to prevent excessive token use

Provide your response in JSON format matching this TypeScript interface:
\`\`\`typescript
interface Response {
  summary: string[];
  whyItMatters: string;
  tags: string[];
}
\`\`\`
Return ONLY valid JSON.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json'
      }
    });

    const responseText = response.text;
    if (!responseText) {
      throw new Error('Gemini returned an empty response');
    }

    const synthesis: SynthesisResult = JSON.parse(responseText.trim());

    // Clean up tags
    if (synthesis.tags) {
      synthesis.tags = synthesis.tags.map(t => t.toLowerCase().replace(/[^a-z0-9-]/g, '').trim()).filter(Boolean);
    }

    return {
      ...note,
      synthesis
    };
  } catch (err: any) {
    console.warn(`[LLM Synthesis] Failed: ${err.message}. Proceeding without synthesis.`);
    return note;
  }
}
