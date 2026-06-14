READING_CATEGORIES = {"discuss", "resonance", "question"}

LEGACY_FLAG_TO_CATEGORY = {
    "💬想聊": "discuss",
    "想聊": "discuss",
    "🤍共鳴": "resonance",
    "共鳴": "resonance",
    "❓困惑": "question",
    "困惑": "question",
}

CATEGORY_TO_LEGACY_FLAG = {
    "discuss": "💬想聊",
    "resonance": "🤍共鳴",
    "question": "❓困惑",
}


def normalize_reading_category(value) -> str | None:
    """Return a stable reading category for new or legacy values."""
    if value is None:
        return None
    normalized = str(value).strip()
    if not normalized:
        return None
    if normalized in READING_CATEGORIES:
        return normalized
    return LEGACY_FLAG_TO_CATEGORY.get(normalized)


def reading_category_from_metadata(metadata: dict) -> str | None:
    """Read the stable category, falling back to legacy flag metadata."""
    return normalize_reading_category(
        metadata.get("category") or metadata.get("flag")
    )
