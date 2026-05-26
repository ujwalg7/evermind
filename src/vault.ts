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

/**
 * Format CanonicalNote into Obsidian markdown with frontmatter YAML
 */
export function formatNoteMarkdown(note: CanonicalNote & { synthesis?: any }): string {
  const frontmatter: string[] = ['---'];
  frontmatter.push(`title: "${note.title.replace(/"/g, '\\"')}"`);
  frontmatter.push(`url: "${note.sourceUrl}"`);
  if (note.author) frontmatter.push(`author: "${note.author.replace(/"/g, '\\"')}"`);
  if (note.publishedDate) frontmatter.push(`published: "${note.publishedDate}"`);
  frontmatter.push(`clipped: "${new Date().toISOString()}"`);
  
  const tags = new Set<string>();
  tags.add('clipped-article');
  if (note.synthesis?.tags) {
    note.synthesis.tags.forEach((t: string) => tags.add(t));
  }
  if (tags.size > 0) {
    frontmatter.push(`tags:\n${Array.from(tags).map(t => `  - ${t}`).join('\n')}`);
  }
  
  if (note.synthesis?.whyItMatters) {
    frontmatter.push(`why_it_matters: "${note.synthesis.whyItMatters.replace(/"/g, '\\"')}"`);
  }
  
  frontmatter.push('---');
  
  let markdown = frontmatter.join('\n') + '\n\n';
  
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
 * Writes a note to the Obsidian vault
 */
export async function writeNoteToVault(
  note: CanonicalNote & { synthesis?: any },
  vaultPath: string
): Promise<string> {
  const filename = `${sanitizeFilename(note.title)}.md`;
  const filePath = path.join(vaultPath, filename);

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
    
    // Ignore dotfiles, node_modules, and configured subdirectories (e.g. attachments)
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
 * Scan vault markdown files, localize any external images
 */
export async function postProcessVault(vaultPath: string, attachmentsSubdir: string): Promise<void> {
  console.log(`[Post-Processor] Scanning vault for external images at: ${vaultPath}`);
  
  if (!fs.existsSync(vaultPath)) {
    throw new Error(`Vault path does not exist: ${vaultPath}`);
  }

  // Gather markdown files, ignoring the attachments subdirectory
  const mdFiles = getMarkdownFiles(vaultPath, vaultPath, [attachmentsSubdir]);
  console.log(`[Post-Processor] Found ${mdFiles.length} notes in vault to check.`);

  let updatedCount = 0;

  for (const filePath of mdFiles) {
    const content = fs.readFileSync(filePath, 'utf-8');
    
    // Quick regex check for external images
    const hasExternalImages = /!\[.*?\]\((https?:\/\/.*?)\)/.test(content) || /src=["'](https?:\/\/.*?)["']/.test(content);
    
    if (hasExternalImages) {
      console.log(`[Post-Processor] Found external images in: ${path.basename(filePath)}`);
      
      // Parse basic title from markdown file (e.g. first heading or filename)
      let title = path.basename(filePath, '.md');
      const titleMatch = content.match(/^#\s+(.+)$/m);
      if (titleMatch) {
        title = titleMatch[1].trim();
      }

      // Read external images
      const images: { originalUrl: string }[] = [];
      const imageRegex = /!\[.*?\]\((https?:\/\/.*?)\)/g;
      let match;
      while ((match = imageRegex.exec(content)) !== null) {
        if (match[1]) images.push({ originalUrl: match[1] });
      }

      const htmlImageRegex = /src=["'](https?:\/\/.*?)["']/g;
      while ((match = htmlImageRegex.exec(content)) !== null) {
        if (match[1]) images.push({ originalUrl: match[1] });
      }

      if (images.length === 0) continue;

      // Construct dummy CanonicalNote to reuse localizeImages pipeline
      const dummyNote: CanonicalNote = {
        title,
        sourceUrl: '', // unknown
        contentMarkdown: content,
        images,
        headings: [],
        confidenceScore: 1.0
      };

      try {
        const localized = await localizeImages(dummyNote, vaultPath, attachmentsSubdir);
        fs.writeFileSync(filePath, localized.contentMarkdown, 'utf-8');
        console.log(`[Post-Processor] Updated note: ${path.basename(filePath)}`);
        updatedCount++;
      } catch (err: any) {
        console.error(`[Post-Processor] Failed to process ${path.basename(filePath)}: ${err.message}`);
      }
    }
  }

  console.log(`[Post-Processor] Scanning finished. Localized images in ${updatedCount} notes.`);
}
