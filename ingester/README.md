# Evermind Ingester

Python curation pipeline for promoting raw vault captures into curated, needs-review, or rejected notes.

## Run

```bash
cd /Users/ujwalgattupalli/Dev/evermind
python3 -m ingester curate --vault "$OBSIDIAN_VAULT_PATH" --limit 10
```

Raw sources live under `inbox/raw/YYYY/MM/DD/`. Curated notes write to `curated/YYYY-MM-DD/`. Borderline output writes to `needs-review/YYYY-MM-DD/`.

## Setup

```bash
python3 -m pip install -r ingester/requirements.txt
```

For re-extraction, set the Node CLI path if the packaged binary is not present:

```bash
export EVERMIND_CLI_PATH="/Users/ujwalgattupalli/Dev/evermind/scraper/bin/evermind"
```

## Checks

```bash
python3 -m compileall -q ingester
python3 -m pytest -q ingester/tests/test_qc_and_writer.py
```
