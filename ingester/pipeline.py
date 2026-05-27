from __future__ import annotations

import datetime as _dt
import logging
from pathlib import Path
from shutil import move
from typing import List, Optional, Set

from .cli_client import EvermindCliClient
from .llm import summarize_note_content
from .models import CuratedNote, QCDecision, RawCapture
from .qc import classify_capture_quality
from .reader import discover_raw_notes, parse_frontmatter_and_body, read_raw_capture
from .titles import note_filename
from .writer import write_curation_note

log = logging.getLogger(__name__)


def _safe_note_source_url(path: Path, raw_url: str) -> str:
    normalized = (raw_url or "").strip()
    if normalized:
        return normalized
    return f"file://{path}"


def _date_partition(iso_timestamp: str) -> Path:
    date_key = iso_timestamp.split("T")[0]
    year, month, day = date_key.split("-")
    return Path(year) / month / day


def _archive_target(
    vault_dir: Path,
    raw_subdir: str,
    note: CuratedNote,
    raw_path: Path,
    failed: bool = False
) -> Path:
    if note.status == "curated" and not failed:
        bucket = Path(raw_subdir)
        title = note.title
    else:
        bucket = Path("needs-review")
        suffix = "Ingest Failed" if failed else "Source"
        title = f"{note.title} - {suffix}"

    target_dir = vault_dir / bucket / _date_partition(note.reviewed_at)
    target_dir.mkdir(parents=True, exist_ok=True)

    filename = note_filename(title) or raw_path.stem
    candidate = target_dir / f"{filename}{raw_path.suffix}"

    counter = 1
    while candidate.exists():
        candidate = target_dir / f"{filename} {counter}{raw_path.suffix}"
        counter += 1

    return candidate


def _archive_raw(raw_path: Path, target: Path) -> None:
    if raw_path.resolve() == target.resolve():
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    move(str(raw_path), str(target))


def _known_raw_sources(vault_dir: Path) -> Set[str]:
    known: Set[str] = set()
    for bucket in ("curated", "needs-review", "rejected"):
        base = vault_dir / bucket
        if not base.exists():
            continue
        for note_path in base.rglob("*.md"):
            frontmatter, _ = parse_frontmatter_and_body(note_path.read_text(encoding="utf-8"))
            raw_source = str(frontmatter.get("raw_source") or "").strip()
            if raw_source:
                known.add(raw_source)
    return known


def _safe_text(value: Optional[str], fallback: str) -> str:
  if value is None:
    return fallback
  return value.strip()


def curate_from_raw(
  vault_path: str,
  raw_subdir: str = "inbox/raw",
  limit: Optional[int] = None,
  reextract: bool = False,
  synthesis: bool = False,
) -> List[Path]:
  vault_dir = Path(vault_path)
  raw_dir = vault_dir / raw_subdir

  raw_paths = discover_raw_notes(raw_dir)
  known_raw_sources = _known_raw_sources(vault_dir)
  raw_paths = [
      path for path in raw_paths
      if path.relative_to(vault_dir).as_posix() not in known_raw_sources
  ]
  if limit is not None:
    raw_paths = raw_paths[:limit]

  client: Optional[EvermindCliClient] = EvermindCliClient() if reextract else None
  written_paths: List[Path] = []

  for path in raw_paths:
      try:
          raw = read_raw_capture(path)
          captured_text = raw.source_content
          source_url = raw.source_url

          if reextract and source_url and client is not None:
              try:
                  payload = client.extract(source_url)
                  cli_note = payload["note"]
                  captured_text = _safe_text(cli_note.get("contentMarkdown"), captured_text)
              except Exception as exc:
                  # Keep deterministic classification based on the raw source when wrapper fails.
                  log.warning("Reextract failed for %s: %s", source_url, exc)

          qc = classify_capture_quality(
              raw.title,
              source_url,
              captured_text,
              raw.capture_status
          )

          note = _to_curated_note(raw, qc, captured_text, path)
          archive_path = _archive_target(vault_dir, raw_subdir, note, path)
          note.raw_source = archive_path.relative_to(vault_dir).as_posix()
          if synthesis:
              enrichments = summarize_note_content(note)
              if enrichments:
                  if enrichments.get("related"):
                      note.related = enrichments["related"]
                  if enrichments.get("tags"):
                      note.tags = enrichments["tags"]
                  if enrichments.get("why_it_matters"):
                      note.why_it_matters = str(enrichments["why_it_matters"])

          written = write_curation_note(vault_dir, note)
          written_paths.append(written)
          _archive_raw(path, archive_path)
      except Exception as exc:
          now = _dt.datetime.utcnow().isoformat(timespec="seconds") + "Z"
          fallback_note = CuratedNote(
              title=path.stem,
              status="needs-review",
              confidence="low",
              temporal_relevance="current",
              source_url=f"file://{path}",
              raw_source=path.as_posix(),
              captured_at=now,
              reviewed_at=now,
          )
          _archive_raw(path, _archive_target(vault_dir, raw_subdir, fallback_note, path, failed=True))
          log.warning("Failed to ingest %s: %s", path, exc)

  return written_paths


def _to_curated_note(raw: RawCapture, qc: QCDecision, source_content: str, raw_path: Path) -> CuratedNote:
  now = _dt.datetime.utcnow().isoformat(timespec="seconds") + "Z"
  status = qc.status
  captured_at = _safe_text(raw.captured_at, now)
  tags = ["evermind", status.replace("-", "_"), qc.capture_status]
  if qc.confidence == "high":
    tags.append("high-confidence")

  return CuratedNote(
    title=raw.title,
    status=status,
    confidence=qc.confidence,
    temporal_relevance=qc.temporal_relevance,
      source_url=_safe_note_source_url(raw_path, raw.source_url),
    raw_source=raw.path,
    captured_at=captured_at,
    reviewed_at=now,
      source_metadata=raw.raw_frontmatter or {},
    related=[],
    supersedes=[],
    contradicts=[],
    tags=tags,
    source_content=source_content
  )
