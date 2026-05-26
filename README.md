# Evermind: Durable Article-to-Obsidian Pipeline

**Evermind** is a robust, low-maintenance, zero-cost-by-default capture engine designed to clip articles and save them to your Obsidian vault as rich Markdown notes with localized images. 

It implements a **fallback ladder** that prioritizes local or free public endpoints, escalating through multiple tiers before using paid APIs, with zero dependencies on LLMs.

---

## 🚀 Key Features

*   **Extraction Fallback Ladder**:
    *   **Tier 2 (Deterministic Raw HTML)**: Uses `@mozilla/readability` to extract clean layouts for free.
    *   **Tier 3 (Playwright Rendered DOM)**: Launches headless Chromium to render JavaScript-heavy or dynamic pages if Tier 2 fails.
    *   **Tier 4 (Jina Reader API)**: 100% free proxy fallback (`https://r.jina.ai`) that yields clean Markdown content.
    *   **Tier 5 (Exa Contents API)**: Optional fallback that queries the Exa Contents API if Tier 4 fails and an API key is configured.
*   **Image Localization & CDN Hardening**: Automatically downloads remote images, stores them locally, and rewrites markdown URLs. Features a rate-limit retry engine with exponential backoff, request pacing delays, referer setting, and date-aware `Retry-After` header parsing to bypass CDN rate limits.
*   **Clear Provenance & Confidence Logging**: Every capture logs extraction tier, confidence, fingerprint (SHA-256), and image statuses in YAML frontmatter. Low-confidence captures are labeled `"partial"` and prepended with a review callout banner.
*   **Obsidian Web Clipper Watcher**: Monitors your Obsidian vault recursively. When you clip a note using the browser extension, the watcher daemon automatically localizes all images instantly.
*   **Batch Ingest Chrome Tabs**: Ingests and processes all currently open tabs in Google Chrome (macOS only).
*   **Single-Binary CLI**: Standalone executables compiled for **macOS** and **Linux ARM64** (aarch64).

---

## 🛠️ Installation & Setup

### 1. Precompiled Binaries
You can download the compiled binaries directly from the Github Releases section:
*   `bin/evermind` for macOS.
*   `bin/evermind-linux-arm64` for Linux ARM64 (Ubuntu 24 slim).

### 2. Browser Setup
To initialize Playwright's local Chromium browser dependency for Tier 3:
```bash
./bin/evermind setup
```

### 3. Environment Variables
Add these keys to your shell profile or a `.env` file in your workspace:
```bash
# Required for Obsidian vault location
export OBSIDIAN_VAULT_PATH="/Users/yourname/Documents/Obsidian Vault"

# Optional: Required if you want to use Tier 5 Exa Contents API fallback
export EXA_API_KEY="your-exa-api-key"
```

---

## 💻 CLI Commands

### 1. Clip a Single URL
Clips an article using the fallback ladder and downloads images:
```bash
./bin/evermind clip https://example.com/article
```
*   Force a specific extraction tier: `-t <2|3|4|5>`
*   Customize target folders: `--vault <path>`, `--inbox <subdir>`, `--attachments <subdir>`

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
*   `src/extractor.ts` — Multi-tier fallback ladder orchestrator.
*   `src/images.ts` — Image scraper, downloader, and link rewriter.
*   `src/tabs.ts` — macOS AppleScript Chrome tab scraper.
*   `src/watcher.ts` — Debounced vault filesystem watcher.
*   `src/vault.ts` — Vault I/O, formatting, and directory scanners.
*   `tests/pipeline.test.ts` — Automated test suite (9 passing tests).

---

## 🤖 Automated CI/CD Releases
We use **GitHub Actions** to automate our build pipeline. When you push a new release tag (e.g. `v1.0.0`), a runner will automatically:
1. Set up the Node environment.
2. Install dependencies.
3. Execute the automated test suite.
4. Cross-compile binaries for both macOS and Linux ARM64.
5. Create a GitHub Release and upload `evermind` and `evermind-linux-arm64` assets.
