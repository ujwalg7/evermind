# Evermind Scraper

Node CLI for extracting article content, clipping open Chrome tabs, localizing images, and packaging the `evermind` binary.

## Setup

```bash
cd /Users/ujwalgattupalli/Dev/evermind/scraper
npm install
```

## Runtime Config

```bash
export OBSIDIAN_VAULT_PATH="/Users/ujwalgattupalli/Dev/evermind/memory"
export EVERMIND_INBOX_SUBDIR="inbox/raw"
export EVERMIND_ATTACHMENTS_SUBDIR="attachments/evermind"
export EXA_API_KEY="your-exa-api-key"
```

## Commands

```bash
npm test --silent
npm run build
npm run package
./bin/evermind setup
./bin/evermind clip https://example.com/article
./bin/evermind extract https://example.com/article --json
./bin/evermind clip-tabs
./bin/evermind post-process
./bin/evermind watch
```

Generated folders such as `node_modules/`, `dist/`, and `bin/` are ignored by Git. Python curation code lives in `../ingester`.
