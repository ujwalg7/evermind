import axios from 'axios';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { chromium } from 'playwright';
import Exa from 'exa-js';
import { CanonicalNote, ImageInfo, Config } from './types';

// Configure Turndown for clean Markdown conversion
const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  hr: '---',
  bulletListMarker: '-'
});

// Avoid converting links to relative if we want to preserve source links
turndownService.addRule('absoluteLinks', {
  filter: ['a'],
  replacement: (content, node) => {
    const href = (node as HTMLAnchorElement).getAttribute('href');
    if (!href) return content;
    // Keep link absolute
    return `[${content}](${href})`;
  }
});

/**
 * Detects if the extracted text belongs to a paywall, cookie wall, or human validation page.
 */
function detectPaywallOrCookieWall(text: string): boolean {
  const lowercaseText = text.toLowerCase();
  const badPatterns = [
    'enable javascript',
    'javascript is disabled',
    'cookies policy',
    'accept all cookies',
    'subscribe to read',
    'register to read',
    'sign in to continue',
    'create an account to read',
    'continue reading with a digital subscription',
    'exclusive content for subscribers',
    'verify you are a human',
    'checking your browser before accessing',
    'please solve the captcha'
  ];

  for (const pattern of badPatterns) {
    if (lowercaseText.includes(pattern)) {
      return true;
    }
  }

  // If text is extremely short and contains paywall-adjacent words, suspect paywall
  const wordCount = text.trim().split(/\s+/).length;
  if (wordCount < 150) {
    const paywallAdjacent = ['subscribe', 'subscription', 'premium', 'log in', 'sign in', 'cookie'];
    const matches = paywallAdjacent.filter(w => lowercaseText.includes(w));
    if (matches.length >= 2) {
      return true;
    }
  }

  return false;
}

/**
 * Calculates a confidence score for the extraction quality.
 */
function calculateConfidence(title: string, textContent: string, hasMetadata: boolean): number {
  if (!title || title.trim() === '') return 0;
  if (!textContent || textContent.trim() === '') return 0;

  if (detectPaywallOrCookieWall(textContent)) {
    console.log('[Pipeline] Paywall or cookie wall detected in text. Forcing fallback.');
    return 0;
  }

  const wordCount = textContent.trim().split(/\s+/).length;
  if (wordCount < 100) return 0.2; // Too short, likely cookie wall or error page

  let score = 0.5;

  // Boost based on text length
  if (wordCount > 300) score += 0.2;
  if (wordCount > 800) score += 0.1;

  // Boost for metadata presence
  if (hasMetadata) score += 0.15;

  return Math.min(score, 1.0);
}

/**
 * Parse metadata from DOM
 */
function parseMetadata(doc: Document) {
  const meta: { [key: string]: string } = {};

  // 1. Basic meta tags
  const metaTags = doc.querySelectorAll('meta');
  metaTags.forEach(tag => {
    const name = tag.getAttribute('name') || tag.getAttribute('property') || tag.getAttribute('itemprop');
    const content = tag.getAttribute('content');
    if (name && content) {
      meta[name.toLowerCase()] = content;
    }
  });

  // 2. Extract OpenGraph and standard values
  const title = meta['og:title'] || meta['twitter:title'] || doc.title || '';
  const author = meta['author'] || meta['article:author'] || meta['og:article:author'] || meta['twitter:creator'] || '';
  const publishedDate = meta['article:published_time'] || meta['pubdate'] || meta['date'] || meta['og:article:published_time'] || '';
  const heroImageUrl = meta['og:image'] || meta['twitter:image'] || meta['image'] || '';

  // 3. Try JSON-LD
  let jsonLdAuthor = '';
  let jsonLdDate = '';
  let jsonLdTitle = '';
  try {
    const jsonLdScripts = doc.querySelectorAll('script[type="application/ld+json"]');
    jsonLdScripts.forEach(script => {
      if (!script.textContent) return;
      try {
        const data = JSON.parse(script.textContent);
        
        // Helper to search JSON-LD objects
        const searchJsonLd = (obj: any) => {
          if (!obj || typeof obj !== 'object') return;
          
          if (obj.headline && !jsonLdTitle) jsonLdTitle = obj.headline;
          
          if (obj.author) {
            if (typeof obj.author === 'string') {
              jsonLdAuthor = obj.author;
            } else if (Array.isArray(obj.author) && obj.author[0]) {
              jsonLdAuthor = obj.author[0].name || obj.author[0].fullName || '';
            } else if (obj.author.name) {
              jsonLdAuthor = obj.author.name;
            }
          }
          if (obj.datePublished && !jsonLdDate) jsonLdDate = obj.datePublished;

          // Recurse down common nested properties
          if (obj['@graph'] && Array.isArray(obj['@graph'])) {
            obj['@graph'].forEach(searchJsonLd);
          }
        };

        searchJsonLd(data);
      } catch {
        // Skip invalid JSON-LD
      }
    });
  } catch {
    // Skip JSON-LD errors
  }

  return {
    title: jsonLdTitle || title,
    author: jsonLdAuthor || author,
    publishedDate: jsonLdDate || publishedDate,
    heroImageUrl,
    hasMetadata: Object.keys(meta).length > 0 || !!jsonLdAuthor
  };
}

/**
 * Extract image elements from the DOM
 */
function extractImages(doc: Document, contentElement: Element | null, baseUrl: string): ImageInfo[] {
  const images: ImageInfo[] = [];
  const seenUrls = new Set<string>();

  const addImage = (src: string) => {
    if (!src || src.startsWith('data:')) return;
    try {
      const absoluteUrl = new URL(src, baseUrl).toString();
      if (!seenUrls.has(absoluteUrl)) {
        seenUrls.add(absoluteUrl);
        images.push({ originalUrl: absoluteUrl });
      }
    } catch {
      // Ignore invalid URLs
    }
  };

  // 1. Gather all images inside the parsed article content
  if (contentElement) {
    const imgElements = contentElement.querySelectorAll('img');
    imgElements.forEach(img => {
      const src = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-original-src');
      if (src) addImage(src);
    });
  }

  // 2. Fallback to all images in the document if content is sparse
  if (images.length === 0) {
    const imgElements = doc.querySelectorAll('img');
    imgElements.forEach(img => {
      const src = img.getAttribute('src') || img.getAttribute('data-src');
      if (src) addImage(src);
    });
  }

  return images;
}

/**
 * Extract headings from the content markdown or element
 */
function extractHeadings(contentElement: Element | null): string[] {
  if (!contentElement) return [];
  const headingElements = contentElement.querySelectorAll('h1, h2, h3, h4');
  const headings: string[] = [];
  headingElements.forEach(h => {
    const text = h.textContent?.trim();
    if (text) headings.push(text);
  });
  return headings;
}

/**
 * Normalizes HTML string to CanonicalNote
 */
export function parseHtml(html: string, url: string): CanonicalNote {
  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;

  // Extract metadata
  const metaData = parseMetadata(doc);

  // Extract main article using Mozilla Readability
  // We clone the document because Readability mutates the DOM
  const docClone = doc.cloneNode(true) as Document;
  const reader = new Readability(docClone);
  const article = reader.parse();

  let contentMarkdown = '';
  let headings: string[] = [];
  let images: ImageInfo[] = [];
  let title = metaData.title || (article ? article.title : '');
  
  if (article && article.content) {
    // Convert extracted article HTML back to clean Markdown
    contentMarkdown = turndownService.turndown(article.content);
    
    // Extract headings from the readability parsed element
    const contentDom = new JSDOM(article.content);
    headings = extractHeadings(contentDom.window.document.body);
    images = extractImages(doc, contentDom.window.document.body, url);
  } else {
    // Fallback: convert the entire body if readability failed
    contentMarkdown = turndownService.turndown(doc.body.innerHTML);
    headings = extractHeadings(doc.body);
    images = extractImages(doc, doc.body, url);
  }

  // If we have a hero image, make sure it is in our image list
  if (metaData.heroImageUrl) {
    const exists = images.some(img => img.originalUrl === metaData.heroImageUrl);
    if (!exists) {
      images.unshift({ originalUrl: metaData.heroImageUrl });
    }
  }

  const confidenceScore = calculateConfidence(
    title, 
    article ? article.textContent : doc.body.textContent || '', 
    metaData.hasMetadata
  );

  return {
    title: title.trim() || 'Untitled Article',
    sourceUrl: url,
    author: metaData.author.trim() || undefined,
    publishedDate: metaData.publishedDate.trim() || undefined,
    heroImageUrl: metaData.heroImageUrl || undefined,
    contentMarkdown,
    headings,
    images,
    confidenceScore
  };
}

/**
 * Helper to parse headings and images from raw markdown (useful for Exa fallback)
 */
function parseMarkdownMetadata(markdown: string): { images: ImageInfo[]; headings: string[] } {
  const headings: string[] = [];
  const images: ImageInfo[] = [];
  
  const lines = markdown.split('\n');
  for (const line of lines) {
    const headingMatch = line.match(/^#+\s+(.+)$/);
    if (headingMatch) {
      headings.push(headingMatch[1].trim());
    }
  }

  const imageRegex = /!\[.*?\]\((.*?)\)/g;
  let match;
  const seenUrls = new Set<string>();
  while ((match = imageRegex.exec(markdown)) !== null) {
    const src = match[1];
    if (src && !src.startsWith('data:') && !seenUrls.has(src)) {
      seenUrls.add(src);
      images.push({ originalUrl: src });
    }
  }

  return { headings, images };
}

/**
 * Tier 2 - Deterministic HTML parser
 */
export async function extractTier2(url: string): Promise<CanonicalNote> {
  const response = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5'
    },
    timeout: 10000
  });

  const html = response.data;
  if (typeof html !== 'string') {
    throw new Error('Response is not HTML string');
  }

  return parseHtml(html, url);
}

/**
 * Tier 3 - Rendered DOM parser using Playwright
 */
export async function extractTier3(url: string): Promise<CanonicalNote> {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 }
    });
    const page = await context.newPage();
    
    // Navigate and wait for content to settle
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000); // 3 seconds grace for dynamic scripts/lazy load
    
    const html = await page.content();
    return parseHtml(html, url);
  } finally {
    await browser.close();
  }
}

/**
 * Tier 4 - Exa Contents API fallback
 */
export async function extractTier4(url: string, apiKey: string): Promise<CanonicalNote> {
  const exa = new Exa(apiKey);
  const response = await exa.getContents([url], {
    text: true
  });

  if (!response.results || response.results.length === 0) {
    throw new Error('Exa returned no results for URL: ' + url);
  }

  const result = response.results[0];
  const markdown = result.text || '';
  const parsed = parseMarkdownMetadata(markdown);

  return {
    title: result.title || 'Untitled Article',
    sourceUrl: url,
    author: result.author || undefined,
    publishedDate: result.publishedDate || undefined,
    contentMarkdown: markdown,
    headings: parsed.headings,
    images: parsed.images,
    confidenceScore: 0.9 // High confidence because Exa handles content cleaning well
  };
}

/**
 * Main orchestrator executing the fallback ladder
 */
export async function runExtractionPipeline(url: string, config: Config): Promise<{ note: CanonicalNote; tierUsed: number }> {
  console.log(`[Pipeline] Starting extraction for URL: ${url}`);
  
  // --- Tier 2: Deterministic HTML ---
  try {
    console.log('[Pipeline] Tier 2: Attempting raw HTML deterministic parsing...');
    const note = await extractTier2(url);
    console.log(`[Pipeline] Tier 2 confidence score: ${note.confidenceScore.toFixed(2)}`);
    if (note.confidenceScore >= config.fallbackThreshold) {
      return { note, tierUsed: 2 };
    }
    console.log(`[Pipeline] Confidence score below threshold (${config.fallbackThreshold}). Escalating to Tier 3.`);
  } catch (err: any) {
    console.warn(`[Pipeline] Tier 2 extraction failed: ${err.message}. Escalating to Tier 3.`);
  }

  // --- Tier 3: Playwright Rendered DOM ---
  let tier3Note: CanonicalNote | null = null;
  try {
    console.log('[Pipeline] Tier 3: Rendering page with Playwright...');
    tier3Note = await extractTier3(url);
    console.log(`[Pipeline] Tier 3 confidence score: ${tier3Note.confidenceScore.toFixed(2)}`);
    if (tier3Note.confidenceScore >= config.fallbackThreshold) {
      return { note: tier3Note, tierUsed: 3 };
    }
    console.log(`[Pipeline] Tier 3 confidence score below threshold. Escalating to Tier 4.`);
  } catch (err: any) {
    console.warn(`[Pipeline] Tier 3 extraction failed: ${err.message}. Escalating to Tier 4.`);
  }

  // --- Tier 4: Exa Contents API ---
  if (config.exaApiKey) {
    try {
      console.log('[Pipeline] Tier 4: Querying Exa Contents API...');
      const note = await extractTier4(url, config.exaApiKey);
      return { note, tierUsed: 4 };
    } catch (err: any) {
      console.error(`[Pipeline] Tier 4 extraction failed: ${err.message}`);
    }
  } else {
    console.warn('[Pipeline] Exa API key missing. Skipping Tier 4 fallback.');
  }

  // Return the best attempt we have
  if (tier3Note) {
    console.log('[Pipeline] Fallback ladder completed. Returning Tier 3 result.');
    return { note: tier3Note, tierUsed: 3 };
  }

  throw new Error('All stages of the extraction ladder failed.');
}
