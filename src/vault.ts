import * as fs from 'fs';
import * as path from 'path';
import { CanonicalNote } from './types';
import { localizeImages } from './images';

/**
 * Replace invalid characters for file paths
 */
function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '-').trim();
}

function deriveFallbackFilename(sourceUrl: string, fingerprint: string): string {
  try {
    const parsed = new URL(sourceUrl);
    const host = parsed.hostname.replace(/^www\./, '');
    const segments = parsed.pathname
      .split('/')
      .map(segment => segment.trim())
      .filter(Boolean)
      .map(segment => segment.replace(/[-_]+/g, ' '))
      .map(segment => segment.replace(/[^\w\s]/g, ''))
      .filter(Boolean);

    const tail = segments.length > 0 ? segments[segments.length - 1] : '';
    const head = segments.length > 1 ? segments[segments.length - 2] : '';
    const candidate = [head, tail].filter(Boolean).join(' ').trim() || tail || host;
    const cleaned = candidate ? sanitizeFilename(candidate).replace(/\s+/g, ' ').trim() : '';
    if (cleaned) {
      return cleaned;
    }
  } catch {
    // Fall through to fingerprint-based name.
  }

  return fingerprint ? `capture-${fingerprint.slice(0, 12)}` : 'capture';
}

function validateCaptureForWrite(note: CanonicalNote & { synthesis?: any }): void {
  if (!note.sourceUrl || !note.sourceUrl.trim()) {
    throw new Error(`Refusing to write capture "${note.title}" because sourceUrl is empty.`);
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(note.sourceUrl);
  } catch {
    throw new Error(`Refusing to write capture "${note.title}" because sourceUrl is invalid: ${note.sourceUrl}`);
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error(`Refusing to write capture "${note.title}" because sourceUrl protocol is unsupported: ${note.sourceUrl}`);
  }

  if (!note.contentMarkdown || !note.contentMarkdown.trim()) {
    throw new Error(`Refusing to write capture "${note.title}" because contentMarkdown is empty.`);
  }
}

/**
 * Helper to parse YAML frontmatter and Markdown content from a note file
 */
function parseFrontmatterAndContent(fileContent: string): { frontmatter: any; contentMarkdown: string } {
  const match = fileContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, contentMarkdown: fileContent };
  }
  
  const yamlText = match[1];
  const contentMarkdown = match[2];
  const frontmatter: any = {};
  
  const lines = yamlText.split('\n');
  let currentKey = '';
  
  for (const line of lines) {
    if (!line.trim()) continue;
    // Simple YAML parser line check
    if (line.startsWith(' ') || line.startsWith('-')) {
      // Ignored nested structures for simple lookup
      continue;
    }
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.substring(0, colonIndex).trim();
      let val = line.substring(colonIndex + 1).trim();
      if (val.startsWith('"') && val.endsWith('"')) {
        val = val.substring(1, val.length - 1);
      }
      frontmatter[key] = val;
    }
  }
  
  return { frontmatter, contentMarkdown };
}

/**
 * Format CanonicalNote into Obsidian markdown with strict capture provenance YAML
 */
export function formatNoteMarkdown(note: CanonicalNote & { synthesis?: any }): string {
  const frontmatter: string[] = ['---'];
  frontmatter.push(`title: "${note.title.replace(/"/g, '\\"')}"`);
  frontmatter.push(`source: "${note.sourceUrl}"`);
  if (note.author) frontmatter.push(`author: "${note.author.replace(/"/g, '\\"')}"`);
  if (note.publishedDate) frontmatter.push(`published: "${note.publishedDate}"`);
  
  const now = new Date().toISOString();
  frontmatter.push(`captured_at: "${now}"`);
  frontmatter.push(`extraction_tier: ${note.tierUsed || 2}`);
  frontmatter.push(`confidence: ${note.confidenceScore.toFixed(2)}`);
  frontmatter.push(`capture_status: "${note.captureStatus}"`);
  frontmatter.push(`fingerprint: "${note.fingerprint}"`);
  
  if (note.extractionError) {
    frontmatter.push(`extraction_error: "${note.extractionError.replace(/"/g, '\\"')}"`);
  }

  if (note.images.length > 0) {
    frontmatter.push('images:');
    note.images.forEach(img => {
      frontmatter.push(`  - url: "${img.originalUrl}"`);
      if (img.localPath) {
        frontmatter.push(`    path: "${img.localPath}"`);
      }
      frontmatter.push(`    status: "${img.status}"`);
    });
  }

  // LLM Synthesis fields (only appended if synthesis is explicitly present)
  if (note.synthesis?.whyItMatters) {
    frontmatter.push(`why_it_matters: "${note.synthesis.whyItMatters.replace(/"/g, '\\"')}"`);
  }
  if (note.synthesis?.tags && note.synthesis.tags.length > 0) {
    frontmatter.push(`tags:\n${note.synthesis.tags.map((t: string) => `  - ${t}`).join('\n')}`);
  }
  
  frontmatter.push('---');
  
  let markdown = frontmatter.join('\n') + '\n\n';

  // For partial captures, prepend a prominent warning callout
  if (note.captureStatus === 'partial') {
    markdown += `> [!WARNING] Partial Capture\n`;
    markdown += `> The content extraction confidence score was low (${note.confidenceScore.toFixed(2)}).\n`;
    markdown += `> The page might be truncated, paywalled, or failed to render. Please review the source URL.\n\n`;
  }
  
  if (note.heroImageUrl) {
    markdown += `![Hero Image](${note.heroImageUrl})\n\n`;
  }
  
  markdown += `# ${note.title}\n\n`;
  
  if (note.synthesis?.summary && note.synthesis.summary.length > 0) {
    markdown += `## Key Takeaways\n`;
    note.synthesis.summary.forEach((item: string) => {
      markdown += `- ${item}\n`;
    });
    markdown += `\n---\n\n`;
  }
  
  markdown += note.contentMarkdown;
  
  return markdown;
}

/**
 * Writes a note to the Obsidian vault's inbox/raw directory
 */
export async function writeNoteToVault(
  note: CanonicalNote & { synthesis?: any },
  vaultPath: string,
  inboxSubdir = 'inbox/raw'
): Promise<string> {
  validateCaptureForWrite(note);

  const targetDir = path.join(vaultPath, inboxSubdir);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const normalizedTitle = sanitizeFilename(note.title) || deriveFallbackFilename(note.sourceUrl, note.fingerprint);
  const filename = `${normalizedTitle}.md`;
  const filePath = path.join(targetDir, filename);

  const markdown = formatNoteMarkdown(note);
  await fs.promises.writeFile(filePath, markdown, 'utf-8');
  console.log(`[Vault] Note successfully written to: ${filePath}`);
  return filePath;
}

/**
 * Walk directory recursively to find all Markdown files
 */
function getMarkdownFiles(dir: string, baseDir: string, ignoreSubdirs: string[]): string[] {
  let results: string[] = [];
  const list = fs.readdirSync(dir);

  list.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (file.startsWith('.') || file === 'node_modules') {
      return;
    }
    
    const relativePath = path.relative(baseDir, filePath);
    if (ignoreSubdirs.some(ignored => relativePath.startsWith(ignored) || file === ignored)) {
      return;
    }

    if (stat && stat.isDirectory()) {
      results = results.concat(getMarkdownFiles(filePath, baseDir, ignoreSubdirs));
    } else if (filePath.endsWith('.md')) {
      results.push(filePath);
    }
  });

  return results;
}

/**
 * Scan vault markdown files, localize any external images and update frontmatter
 */
export async function postProcessVault(vaultPath: string, attachmentsSubdir: string): Promise<void> {
  console.log(`[Post-Processor] Scanning vault for external images at: ${vaultPath}`);
  
  if (!fs.existsSync(vaultPath)) {
    throw new Error(`Vault path does not exist: ${vaultPath}`);
  }

  // Gather markdown files, ignoring the attachments folder
  const mdFiles = getMarkdownFiles(vaultPath, vaultPath, [attachmentsSubdir]);
  console.log(`[Post-Processor] Found ${mdFiles.length} notes in vault to check.`);

  let updatedCount = 0;

  for (const filePath of mdFiles) {
    const rawContent = fs.readFileSync(filePath, 'utf-8');
    
    // Quick check for external images
    const hasExternalImages = /!\[.*?\]\((https?:\/\/.*?)\)/.test(rawContent) || /src=["'](https?:\/\/.*?)["']/.test(rawContent);
    
    if (hasExternalImages) {
      console.log(`[Post-Processor] Found external images in: ${path.basename(filePath)}`);
      
      const { frontmatter, contentMarkdown } = parseFrontmatterAndContent(rawContent);

      // Parse metadata from frontmatter or filename
      const title = frontmatter.title || path.basename(filePath, '.md');
      const sourceUrl = frontmatter.source || '';
      const author = frontmatter.author || undefined;
      const publishedDate = frontmatter.published || undefined;
      const confidenceScore = parseFloat(frontmatter.confidence || '1.0');
      const captureStatus = frontmatter.capture_status || 'complete';
      const fingerprint = frontmatter.fingerprint || '';
      const tierUsed = parseInt(frontmatter.extraction_tier || '2');

      // Extract external images
      const images: { originalUrl: string; status: 'skipped' }[] = [];
      const imageRegex = /!\[.*?\]\((https?:\/\/.*?)\)/g;
      let match;
      const seenUrls = new Set<string>();
      
      while ((match = imageRegex.exec(contentMarkdown)) !== null) {
        if (match[1] && !seenUrls.has(match[1])) {
          seenUrls.add(match[1]);
          images.push({ originalUrl: match[1], status: 'skipped' });
        }
      }

      const htmlImageRegex = /src=["'](https?:\/\/.*?)["']/g;
      while ((match = htmlImageRegex.exec(contentMarkdown)) !== null) {
        if (match[1] && !seenUrls.has(match[1])) {
          seenUrls.add(match[1]);
          images.push({ originalUrl: match[1], status: 'skipped' });
        }
      }

      if (images.length === 0) continue;

      const parsedNote: CanonicalNote = {
        title,
        sourceUrl,
        contentMarkdown,
        images,
        headings: [],
        confidenceScore,
        captureStatus,
        fingerprint,
        tierUsed
      };

      try {
        // Run localization
        const localized = await localizeImages(parsedNote, vaultPath, attachmentsSubdir);
        
        // Re-format note with updated image paths and status
        const updatedMarkdown = formatNoteMarkdown(localized);
        
        fs.writeFileSync(filePath, updatedMarkdown, 'utf-8');
        console.log(`[Post-Processor] Updated note: ${path.basename(filePath)}`);
        updatedCount++;
      } catch (err: any) {
        console.error(`[Post-Processor] Failed to process ${path.basename(filePath)}: ${err.message}`);
      }
    }
  }

  console.log(`[Post-Processor] Scanning finished. Localized images in ${updatedCount} notes.`);
}
