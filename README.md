# Evermind

Evermind is a local article capture and memory-curation workspace. Git tracks the code and project instructions; Obsidian and OCI bucket sync own the vault data.

## Layout

- `scraper/`: Node CLI for article extraction, clipping, image localization, and packaging.
- `ingester/`: Python curation pipeline for raw capture QC and curated-note generation.
- `evermind/`: Git-ignored Obsidian vault with raw captures, curated notes, needs-review notes, tags, and attachments.

## Runtime Config

```bash
export OBSIDIAN_VAULT_PATH="/Users/ujwalgattupalli/Dev/evermind/evermind"
export EVERMIND_INBOX_SUBDIR="inbox/raw"
export EVERMIND_ATTACHMENTS_SUBDIR="attachments/evermind"
export EVERMIND_CLI_PATH="/Users/ujwalgattupalli/Dev/evermind/scraper/bin/evermind"
```

## Scraper

```bash
cd /Users/ujwalgattupalli/Dev/evermind/scraper
npm install
npm test --silent
npm run build
./bin/evermind clip https://example.com/article
```

The CLI binary name remains `evermind`. Local `node_modules/`, `dist/`, and `bin/` folders are generated artifacts and are ignored by Git.

## Ingester

```bash
cd /Users/ujwalgattupalli/Dev/evermind
python3 -m pip install -r ingester/requirements.txt
python3 -m ingester curate --vault "$OBSIDIAN_VAULT_PATH" --limit 10
```

Raw captures are stored under `evermind/inbox/raw/YYYY/MM/DD/`. Curated output goes to `evermind/curated/YYYY-MM-DD/`. Borderline output goes to `evermind/needs-review/YYYY-MM-DD/`.

## Verification

```bash
cd /Users/ujwalgattupalli/Dev/evermind
git status --short --untracked-files=all

cd /Users/ujwalgattupalli/Dev/evermind/scraper
npm test --silent

cd /Users/ujwalgattupalli/Dev/evermind
python3 -m compileall -q ingester
python3 -m pytest -q ingester/tests/test_qc_and_writer.py
```
