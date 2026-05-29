import pytest


@pytest.mark.asyncio
async def test_list_dream_candidates_returns_flagged_active_buckets(bucket_mgr):
    first = await bucket_mgr.create(
        content="first dream material",
        domain=["关系"],
        bucket_type="dynamic",
    )
    second = await bucket_mgr.create(
        content="second dream material",
        domain=["成长"],
        bucket_type="dynamic",
    )
    ordinary = await bucket_mgr.create(
        content="ordinary memory",
        domain=["日常"],
        bucket_type="dynamic",
    )
    feel = await bucket_mgr.create(
        content="feel should not be candidate",
        domain=[],
        bucket_type="feel",
    )

    await bucket_mgr.update(first, dream_candidate=True)
    await bucket_mgr.update(second, dream_candidate=True)
    await bucket_mgr.update(ordinary, dream_candidate=False)
    await bucket_mgr.update(feel, dream_candidate=True)

    candidates = await bucket_mgr.list_dream_candidates()
    candidate_ids = [b["id"] for b in candidates]

    assert second in candidate_ids
    assert first in candidate_ids
    assert ordinary not in candidate_ids
    assert feel not in candidate_ids


@pytest.mark.asyncio
async def test_dream_candidates_can_be_resolved_or_digested(bucket_mgr):
    bucket_id = await bucket_mgr.create(
        content="resolved but still meaningful",
        domain=["心理"],
        bucket_type="dynamic",
    )

    await bucket_mgr.update(
        bucket_id,
        dream_candidate=True,
        resolved=True,
        digested=True,
    )

    candidates = await bucket_mgr.list_dream_candidates()

    assert [b["id"] for b in candidates] == [bucket_id]
    assert candidates[0]["metadata"]["resolved"] is True
    assert candidates[0]["metadata"]["digested"] is True


def test_trace_and_dream_are_wired_to_dream_candidate():
    source = open("server.py", encoding="utf-8").read()

    assert "dream_candidate: int = -1" in source
    assert 'updates["dream_candidate"] = bool(dream_candidate)' in source
    assert "bucket_mgr.list_dream_candidates(limit=10)" in source
    assert "已标记的做梦素材" in source
