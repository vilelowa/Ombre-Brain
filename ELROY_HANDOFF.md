# Elroy / Ombre Brain Handoff

## Current State

Working tree was clean before this handoff file was added.

Recent commits:

- `d41e75a feat: add dream reflection storage and core layer loader`
- `be744ca fix: B-01 to B-10 OB bug fixes`

Latest verified test run:

```text
54 passed, 7 skipped
```

Command used:

```bash
python3 -m pytest tests/
```

## Completed

### OB Bug Fixes

The B-01 through B-10 behavior-spec fixes are implemented and covered by regression tests.

Key outcomes:

- `resolved=True` no longer immediately archives buckets.
- Fractional `activation_count` affects decay score.
- New buckets start with `activation_count=0`.
- Time score uses `exp(-0.02 * days)`.
- Search weights default to spec values: `time_proximity=1.5`, `content_weight=1.0`.
- Auto-resolve applies the resolved factor in the same decay cycle.
- `hold()` preserves explicit user `valence/arousal`.
- `feel` buckets preserve `domain=[]`.

### Core Layer

Implemented a read-only Core layer under:

```text
permanent/core/
```

Relevant code:

- `BucketManager.core_dir`
- `BucketManager.list_core()`
- `BucketManager.render_core_context()`
- `server.core(max_tokens=4000)`

Behavior:

- Core entries are directly injectable context.
- Core is excluded from normal `list_all()`, search, stats, `_find_bucket_file()`, and decay paths.
- No automatic Core promotion exists yet.

### Dream Candidate Plumbing

Implemented minimal metadata plumbing for dream material:

- `BucketManager.update(..., dream_candidate=True/False)`
- `BucketManager.list_dream_candidates()`
- `trace(..., dream_candidate=1/0)`
- `dream()` now prioritizes flagged dream candidates and falls back to recent memories.

No LLM-based dream generation was added.

### Dream Reflection Storage

Implemented storage-only dream reflections under:

```text
feel/dream/
```

Relevant code:

- `BucketManager.create_dream_reflection(...)`
- `BucketManager.list_dream_reflections(...)`

Supported `influence_type` values:

- `tone`
- `attention`
- `unresolved`

No slot pruning has been added yet.

## Tests Added

- `tests/test_core_layer.py`
- `tests/test_dream_candidates.py`
- `tests/test_dream_reflections.py`

Existing scoring tests also now include B-01 through B-10 regression coverage.

## Environment Notes

The local Python is system Python 3.9.6.

`python-frontmatter==1.1.0` is needed because `python-frontmatter 1.2.0` imports `typing.TypeGuard`, which breaks on Python 3.9.

`dehydrator.py` has:

```python
from __future__ import annotations
```

This keeps Python 3.10-style annotations import-safe on Python 3.9.

## Recommended Next Step

Next safest implementation step:

### Dream Reflection Slot Limits

Add pruning rules for stored dream reflections:

- `tone`: keep latest 3
- `attention`: keep latest 5
- `unresolved`: keep all for now

Suggested approach:

1. Add `BucketManager.prune_dream_reflections()`.
2. Call it after `create_dream_reflection()`.
3. Delete or archive overflow reflections from `feel/dream/`.
4. Add focused tests for each influence type.

After that, the system is ready for the first LLM-backed dream generation pass.

