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
/**
 * Downloads a remote image and saves it locally, with retries on rate limits or server errors.
 * Returns the final filename
 */
async function downloadImageFile(
  imageUrl: string,
  targetDir: string,
  baseName: string,
  index: number
): Promise<string> {
  const retries = 4;
  const initialDelay = 1500;
  let response: any;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      let referer = imageUrl;
      try {
        referer = new URL(imageUrl).origin;
      } catch {
        // Fallback if URL parsing fails
      }

      response = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 15000, // 15 seconds timeout
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': referer
        }
      });
      break; // Success!
    } catch (err: any) {
      const isAxiosError = axios.isAxiosError(err);
      const status = isAxiosError ? err.response?.status : null;
      const code = isAxiosError ? err.code : null;
      
      const isTimeout = code === 'ECONNABORTED' || code === 'ETIMEDOUT';
      const isRetryableStatus = status === 429 || (status && status >= 500);

      // Retry on 429 (rate limits), 5xx (server errors), and timeouts
      if (attempt < retries && (isRetryableStatus || isTimeout)) {
        let waitTime = initialDelay * Math.pow(2, attempt - 1);
        
        const retryAfter = isAxiosError ? err.response?.headers['retry-after'] : null;
        if (retryAfter) {
          const seconds = parseInt(retryAfter, 10);
          if (!isNaN(seconds)) {
            waitTime = seconds * 1000;
          } else {
            const parsedDate = Date.parse(retryAfter);
            if (!isNaN(parsedDate)) {
              waitTime = Math.max(0, parsedDate - Date.now());
            }
          }
        }
        
        console.warn(`[Image Downloader] CDN error (status: ${status || 'timeout'}). Attempt ${attempt}/${retries}. Retrying in ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else {
        throw err;
      }
    }
  }

  const contentType = response.headers['content-type'];
  let extension = '';
  if (contentType && typeof contentType === 'string') {
    extension = mime.extension(contentType) || '';
  }

  // Fallback if mime type resolution fails
  if (!extension) {
    try {
      const parsedUrl = new URL(imageUrl);
      const pathname = parsedUrl.pathname;
      const extMatch = pathname.match(/\.([a-zA-Z0-9]+)$/);
      if (extMatch) {
        extension = extMatch[1];
      } else {
        extension = 'jpg';
      }
    } catch {
      extension = 'jpg';
    }
  }

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

    // Introduce spacing delay to prevent hitting burst rate limits
    if (i > 0) {
      await new Promise(resolve => setTimeout(resolve, 250));
    }

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

        // Introduce spacing delay
        if (i > 0 || note.images.length > 0) {
          await new Promise(resolve => setTimeout(resolve, 250));
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
