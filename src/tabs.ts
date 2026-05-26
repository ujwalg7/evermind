import { spawn } from 'child_process';

const CHROME_TABS_APPLESCRIPT = `
tell application "Google Chrome"
    if not (exists window 1) then
        return ""
    end if
    set tabInfo to ""
    set winList to every window
    repeat with win in winList
        try
            set tabList to every tab of win
            repeat with t in tabList
                set tabInfo to tabInfo & (URL of t) & "|||" & (title of t) & "\n"
            end repeat
        end try
    end repeat
    return tabInfo
end tell
`;

export interface ChromeTab {
  url: string;
  title: string;
}

/**
 * Executes macOS AppleScript to retrieve all open Google Chrome tabs.
 */
export function getChromeTabs(): Promise<ChromeTab[]> {
  return new Promise((resolve, reject) => {
    // Only works on macOS
    if (process.platform !== 'darwin') {
      reject(new Error('Chrome tab ingestion is only supported on macOS (requires AppleScript).'));
      return;
    }

    const child = spawn('osascript');
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', data => {
      stdout += data.toString();
    });

    child.stderr.on('data', data => {
      stderr += data.toString();
    });

    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(`AppleScript exited with code ${code}. Error: ${stderr.trim()}`));
        return;
      }

      const tabs: ChromeTab[] = [];
      const lines = stdout.split('\n');
      
      for (const line of lines) {
        if (!line.trim()) continue;
        const parts = line.split('|||');
        if (parts.length >= 2) {
          const url = parts[0].trim();
          const title = parts.slice(1).join('|||').trim();
          
          // Skip empty or browser internal urls
          if (
            url && 
            !url.startsWith('chrome://') && 
            !url.startsWith('chrome-extension://') &&
            url !== 'about:blank'
          ) {
            tabs.push({ url, title });
          }
        }
      }
      resolve(tabs);
    });

    child.stdin.write(CHROME_TABS_APPLESCRIPT);
    child.stdin.end();
  });
}
