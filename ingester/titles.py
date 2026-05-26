from __future__ import annotations

import html
import re
import unicodedata

_ACRONYMS = {
    "ai",
    "api",
    "aws",
    "cli",
    "gpu",
    "ide",
    "llm",
    "llms",
    "oci",
    "rag",
    "rl",
}


def clean_display_title(value: str) -> str:
    cleaned = html.unescape(value or "")
    cleaned = unicodedata.normalize("NFKC", cleaned)
    replacements = {
        "\u2018": "'",
        "\u2019": "'",
        "\u201c": "'",
        "\u201d": "'",
        "\u2013": "-",
        "\u2014": "-",
        "\u2026": "...",
    }
    for old, new in replacements.items():
        cleaned = cleaned.replace(old, new)
    cleaned = re.sub(r"[\x00-\x1f\x7f]", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" .-_")
    return cleaned or "Untitled Capture"


def elegant_title(value: str) -> str:
    cleaned = clean_display_title(value).replace("-", " ")
    words = []
    for word in cleaned.split():
        bare = re.sub(r"[^A-Za-z0-9]", "", word)
        if bare.lower() in _ACRONYMS:
            words.append(word.upper())
        elif any(ch.isupper() for ch in word[1:]):
            words.append(word)
        else:
            words.append(word[:1].upper() + word[1:].lower())
    return " ".join(words).strip() or "Untitled Capture"


def note_filename(value: str, max_length: int = 140) -> str:
    cleaned = clean_display_title(value)
    cleaned = re.sub(r"[\\/:*?\"<>|]+", " - ", cleaned)
    cleaned = re.sub(r"[#\[\]\(\){}!`~$%^=+;,]+", "", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" .-_")
    if len(cleaned) > max_length:
        cleaned = cleaned[:max_length].rsplit(" ", 1)[0].strip(" .-_") or cleaned[:max_length].strip(" .-_")
    return cleaned or "Untitled Capture"
