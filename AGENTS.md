# Evermind Agent Instructions

Canonical workspace: `/Users/ujwalgattupalli/Dev/evermind`.

- Treat this repository as the single Evermind project. Do not split work between this monorepo and the retired scraper-only workspace.
- Node scraper CLI code, tests, and packaging live under `scraper/`.
- Python curation pipeline code and tests live under `ingester/`.
- The Obsidian vault lives under `evermind/`.
- `evermind/` is not Git-owned. Obsidian and OCI bucket sync own vault persistence.
- Do not stage, commit, or rewrite vault contents unless the user explicitly asks for vault cleanup.
- Run scraper commands from `/Users/ujwalgattupalli/Dev/evermind/scraper`.
- Run ingester commands from `/Users/ujwalgattupalli/Dev/evermind`.
- Canonical runtime config:
  - `OBSIDIAN_VAULT_PATH=/Users/ujwalgattupalli/Dev/evermind/evermind`
  - `EVERMIND_INBOX_SUBDIR=inbox/raw`
  - `EVERMIND_ATTACHMENTS_SUBDIR=attachments/evermind`

caveman mode
