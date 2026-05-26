# Evermind: Durable Article-to-Obsidian Pipeline

**Evermind** is a cost-effective, robust, low-maintenance pipeline designed to capture articles and save them to your Obsidian vault as rich Markdown notes with localized images. 

Rather than relying on one extraction method, it implements a **fallback ladder** that prioritizes free/local operations before escalating to paid APIs or token-heavy LLMs.

---

## 🚀 Key Features

*   **Extraction Fallback Ladder**:
    *   **Tier 2 (Deterministic Raw HTML)**: Uses `@mozilla/readability` to extract clean layouts for free.
    *   **Tier 3 (Playwright Rendered DOM)**: Launches headless Chromium to render JavaScript-heavy or dynamic pages if Tier 2 fails.
    *   **Tier 4 (Exa API)**: Queries the Exa Contents API as a high-reliability fallback if local rendering fails.
*   **Image Localization**: Automatically downloads remote images, stores them in your vault's attachments folder, and rewrites URLs in the markdown to relative local links.
*   **Gemini Note Synthesis (Tier 6)**: Runs Gemini 2.5 Flash at the end of the chain to generate structured bullet-point takeaways, concept tags, and a "why it matters" summary inside the YAML frontmatter.
*   **Obsidian Web Clipper Watcher**: Monitors your Obsidian vault recursively. When you clip a note using the official browser extension, the watcher daemon automatically localizes all images instantly.
*   **Batch Ingest Chrome Tabs**: Ingests and processes all currently open tabs in Google Chrome (macOS only).
*   **Single-Binary CLI**: Packaged as a standalone native macOS executable.

---

## 🛠️ Installation & Setup

### 1. Requirements
*   **macOS** (for Chrome tab ingestion and native filesystem watching).
*   **Node.js 18+** (if running via npm/source).

### 2. Verification / Browser Setup
To initialize Playwright's Chromium browser dependency:
```bash
./bin/evermind setup
```

### 3. Environment Variables
Add your keys and configuration to your shell profile or a `.env` file in your workspace:
```bash
# Required for Obsidian vault location
export OBSIDIAN_VAULT_PATH="/Users/yourname/Documents/Obsidian Vault"

# Required for Tier 4 (Exa Fallback)
export EXA_API_KEY="your-exa-api-key"

# Required for Tier 6 (Gemini Synthesis)
export GEMINI_API_KEY="your-gemini-api-key"
```

---

## 💻 CLI Commands

### 1. Clip a Single URL
Clips an article using the fallback ladder, downloads images, and runs LLM synthesis:
```bash
./bin/evermind clip https://example.com/article
```
*   Disable LLM polish: `--no-llm`
*   Force a specific tier: `-t 2` (HTML only) or `-t 3` (Playwright only)

### 2. Ingest Open Chrome Tabs (macOS)
Clips all active tabs in Chrome. Catches single-tab failures gracefully:
```bash
./bin/evermind clip-tabs
```
*   Filter by domain: `clip-tabs -d infoworld.com,medium.com` (only clips tabs matching these domains).

### 3. Start the Vault Watcher Daemon
Starts a background folder watcher that automatically post-processes new files created by the browser extension:
```bash
./bin/evermind watch
```

### 4. Manual Vault Post-Processing
Scans existing notes in the vault, downloads all remote image URLs, and updates links:
```bash
./bin/evermind post-process
```

---

## 📁 Repository Structure
*   `src/cli.ts` — Command parser and controller.
*   `src/extractor.ts` — The fallback ladder orchestrator.
*   `src/images.ts` — Image scraper, downloader, and link rewriter.
*   `src/llm.ts` — Gemini synthesis client.
*   `src/tabs.ts` — macOS AppleScript Chrome tab scraper.
*   `src/watcher.ts` — Debounced vault filesystem watcher.
*   `src/vault.ts` — Vault I/O, formatting, and directory scanners.
