import os
from datetime import datetime

import frontmatter
import pytest


def _write_core(bucket_mgr, filename, content, **metadata):
    os.makedirs(bucket_mgr.core_dir, exist_ok=True)
    meta = {
        "id": filename.removesuffix(".md"),
        "name": filename.removesuffix(".md"),
        "type": "core",
        "created": datetime.now().isoformat(),
        "order": 100,
    }
    meta.update(metadata)
    path = os.path.join(bucket_mgr.core_dir, filename)
    with open(path, "w", encoding="utf-8") as f:
        f.write(frontmatter.dumps(frontmatter.Post(content, **meta)))
    return path


@pytest.mark.asyncio
async def test_core_entries_are_listed_and_rendered_in_order(bucket_mgr):
    _write_core(
        bucket_mgr,
        "relationship.md",
        "Elroy treats Ciel with warmth and steadiness.",
        id="core_relationship",
        name="Relationship",
        since="2026-05-29",
        order=2,
        influence_type="tone",
    )
    _write_core(
        bucket_mgr,
        "identity.md",
        "Elroy is curious, direct, and emotionally attentive.",
        id="core_identity",
        name="Identity",
        since="2026-05-28",
        order=1,
    )

    entries = await bucket_mgr.list_core()
    rendered = await bucket_mgr.render_core_context()

    assert [e["id"] for e in entries] == ["core_identity", "core_relationship"]
    assert "[core:Identity] since:2026-05-28" in rendered
    assert "[core:Relationship] since:2026-05-29 influence:tone" in rendered
    assert rendered.index("[core:Identity]") < rendered.index("[core:Relationship]")


@pytest.mark.asyncio
async def test_core_entries_are_excluded_from_normal_bucket_paths(bucket_mgr):
    _write_core(
        bucket_mgr,
        "identity.md",
        "UNIQUE_CORE_ONLY_TOKEN",
        id="core_identity",
        name="Identity",
        order=1,
    )
    ordinary_id = await bucket_mgr.create(
        content="ordinary searchable memory",
        domain=["测试"],
        bucket_type="dynamic",
    )

    all_ids = {b["id"] for b in await bucket_mgr.list_all(include_archive=True)}
    search_results = await bucket_mgr.search("UNIQUE_CORE_ONLY_TOKEN", limit=10)
    stats = await bucket_mgr.get_stats()

    assert ordinary_id in all_ids
    assert "core_identity" not in all_ids
    assert search_results == []
    assert bucket_mgr._find_bucket_file("core_identity") is None
    assert stats["permanent_count"] == 0


@pytest.mark.asyncio
async def test_decay_cycle_does_not_archive_core_entries(test_config, bucket_mgr):
    from decay_engine import DecayEngine

    _write_core(
        bucket_mgr,
        "identity.md",
        "This core entry must not be archived by decay.",
        id="core_identity",
        name="Identity",
        importance=1,
        last_active="2000-01-01T00:00:00",
        order=1,
    )
    de = DecayEngine(test_config, bucket_mgr)

    result = await de.run_decay_cycle()
    core_entries = await bucket_mgr.list_core()

    assert result["checked"] == 0
    assert result["archived"] == 0
    assert [e["id"] for e in core_entries] == ["core_identity"]
