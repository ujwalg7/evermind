import * as fs from 'fs';
import * as path from 'path';
import { postProcessVault } from './vault';

/**
 * Monitors the Obsidian vault for newly created/modified markdown files
 * and triggers image localization.
 */
export function watchVault(vaultPath: string, attachmentsSubdir: string): void {
  console.log(`[Watcher] Monitoring directory: ${vaultPath}`);
  console.log(`[Watcher] Attachment subdirectory to ignore: ${attachmentsSubdir}`);

  let debounceTimeout: NodeJS.Timeout | null = null;
  const filesQueue = new Set<string>();

  const processQueue = async () => {
    if (filesQueue.size === 0) return;
    
    const filesArray = Array.from(filesQueue);
    console.log(`[Watcher] Detected changes in: ${filesArray.map(f => path.basename(f)).join(', ')}`);
    filesQueue.clear();

    try {
      // Run the general post-process routine to check and localize
      await postProcessVault(vaultPath, attachmentsSubdir);
    } catch (err: any) {
      console.error(`[Watcher Error] Failed during auto post-processing: ${err.message}`);
    }
  };

  // Native recursive watch (highly efficient on macOS)
  try {
    fs.watch(vaultPath, { recursive: true }, (eventType, filename) => {
      if (!filename) return;

      // Ignore dotfiles, temp files, node_modules, and files inside attachments subdir
      if (
        filename.startsWith('.') ||
        filename.includes('node_modules') ||
        filename.startsWith(attachmentsSubdir)
      ) {
        return;
      }

      // We only care about Markdown note changes
      if (filename.endsWith('.md')) {
        const fullPath = path.join(vaultPath, filename);
        filesQueue.add(fullPath);

        // Debounce triggers by 2 seconds to allow write operations to settle
        if (debounceTimeout) {
          clearTimeout(debounceTimeout);
        }
        debounceTimeout = setTimeout(processQueue, 2000);
      }
    });

    console.log(`[Watcher] Watcher daemon is running. Press Ctrl+C to exit.`);
  } catch (err: any) {
    console.error(`[Watcher Error] Failed to start native folder watcher: ${err.message}`);
    throw err;
  }
}
