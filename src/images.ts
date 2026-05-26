import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import mime from 'mime-types';
import { CanonicalNote, ImageInfo } from './types';

/**
 * Clean strings for safe filenames
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // remove non-alphanumeric/spaces/dashes
    .replace(/[\s_]+/g, '-')   // replace spaces/underscores with dashes
    .replace(/^-+|-+$/g, '')   // trim leading/trailing dashes
    .substring(0, 50);          // limit length
}

/**
 * Downloads a remote image and saves it locally
 * Returns the final filename
 */
async function downloadImageFile(
  imageUrl: string,
  targetDir: string,
  baseName: string,
  index: number
): Promise<string> {
  const response = await axios.get(imageUrl, {
    responseType: 'arraybuffer',
    timeout: 10000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': imageUrl
    }
  });

  const contentType = response.headers['content-type'];
  let extension = '';
  if (contentType && typeof contentType === 'string') {
    extension = mime.extension(contentType) || '';
  }

  // Fallback if mime type resolution fails
  if (!extension) {
    const parsedUrl = new URL(imageUrl);
    const pathname = parsedUrl.pathname;
    const extMatch = pathname.match(/\.([a-zA-Z0-9]+)$/);
    if (extMatch) {
      extension = extMatch[1];
    } else {
      extension = 'jpg'; // Default fallback
    }
  }

  // Ensure clean extension
  if (extension === 'jpeg') extension = 'jpg';

  const filename = `${baseName}-image-${index}.${extension}`;
  const fullPath = path.join(targetDir, filename);

  await fs.promises.writeFile(fullPath, Buffer.from(response.data));
  return filename;
}

/**
 * Downloads all remote images in a note and rewrites the markdown links
 */
export async function localizeImages(
  note: CanonicalNote,
  vaultPath: string,
  attachmentsSubdir: string
): Promise<CanonicalNote> {
  const targetDir = path.join(vaultPath, attachmentsSubdir);
  
  // Ensure target attachments directory exists
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const baseName = slugify(note.title) || 'article';
  const updatedImages: ImageInfo[] = [];
  let updatedMarkdown = note.contentMarkdown;
  let updatedHeroImageUrl = note.heroImageUrl;

  console.log(`[Image Localization] Found ${note.images.length} images in metadata to process...`);

  for (let i = 0; i < note.images.length; i++) {
    const img = note.images[i];
    const originalUrl = img.originalUrl;

    try {
      console.log(`[Image Localization] Downloading [${i + 1}/${note.images.length}]: ${originalUrl}`);
      const filename = await downloadImageFile(originalUrl, targetDir, baseName, i + 1);
      
      const localRelativePath = `${attachmentsSubdir}/${filename}`;
      
      // Update image structure
      updatedImages.push({
        originalUrl,
        localFilename: filename,
        localPath: localRelativePath,
        status: 'downloaded'
      });

      // Rewrite markdown image syntax: ![alt](originalUrl) -> ![alt](localRelativePath)
      const escapedUrl = originalUrl.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const markdownPattern = new RegExp(`!\\[(.*?)\\]\\(${escapedUrl}(?:\\s+".*?")?\\)`, 'g');
      updatedMarkdown = updatedMarkdown.replace(markdownPattern, `![$1](${localRelativePath})`);

      // Also rewrite standard image HTML if it exists
      const htmlPattern = new RegExp(`src=["']${escapedUrl}["']`, 'g');
      updatedMarkdown = updatedMarkdown.replace(htmlPattern, `src="${localRelativePath}"`);

      // Update hero image if matched
      if (updatedHeroImageUrl === originalUrl) {
        updatedHeroImageUrl = localRelativePath;
      }
    } catch (err: any) {
      console.warn(`[Image Localization] Failed to localize image ${originalUrl}: ${err.message}`);
      // Maintain the original remote reference, mark as failed
      updatedImages.push({
        originalUrl,
        status: 'failed'
      });
      // The markdown remains untouched (still references original remote URL)
    }
  }

  // Scan note for any remaining image patterns that might not be in our metadata
  const remainingImages = updatedMarkdown.match(/!\[.*?\]\((https?:\/\/.*?)\)/g);
  if (remainingImages) {
    console.log(`[Image Localization] Scanning remaining inline remote images in markdown...`);
    for (let i = 0; i < remainingImages.length; i++) {
      const match = remainingImages[i].match(/!\[.*?\]\((https?:\/\/.*?)\)/);
      if (match && match[1]) {
        const originalUrl = match[1];
        if (updatedImages.some(img => img.originalUrl === originalUrl)) {
          continue; // Already processed
        }
        try {
          const index = note.images.length + i + 1;
          const filename = await downloadImageFile(originalUrl, targetDir, baseName, index);
          const localRelativePath = `${attachmentsSubdir}/${filename}`;
          
          updatedImages.push({
            originalUrl,
            localFilename: filename,
            localPath: localRelativePath,
            status: 'downloaded'
          });

          const escapedUrl = originalUrl.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
          const markdownPattern = new RegExp(`!\\[(.*?)\\]\\(${escapedUrl}(?:\\s+".*?")?\\)`, 'g');
          updatedMarkdown = updatedMarkdown.replace(markdownPattern, `![$1](${localRelativePath})`);
          
          if (updatedHeroImageUrl === originalUrl) {
            updatedHeroImageUrl = localRelativePath;
          }
        } catch (err: any) {
          console.warn(`[Image Localization] Failed to localize leftover image ${originalUrl}: ${err.message}`);
          updatedImages.push({
            originalUrl,
            status: 'failed'
          });
        }
      }
    }
  }

  return {
    ...note,
    contentMarkdown: updatedMarkdown,
    heroImageUrl: updatedHeroImageUrl,
    images: updatedImages
  };
}
