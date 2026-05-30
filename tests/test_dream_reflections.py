import os

import pytest


@pytest.mark.asyncio
async def test_create_and_list_dream_reflections(bucket_mgr):
    first = await bucket_mgr.create_dream_reflection(
        content="A tone reflection",
        influence_type="tone",
        source_bucket_ids=["source-a"],
        name="tone-shift",
        valence=0.7,
        arousal=0.4,
    )
    second = await bucket_mgr.create_dream_reflection(
        content="An attention reflection",
        influence_type="attention",
        source_bucket_ids=["source-b"],
        name="attention-shift",
    )

    reflections = await bucket_mgr.list_dream_reflections()
    reflection_ids = [r["id"] for r in reflections]

    assert second in reflection_ids
    assert first in reflection_ids
    assert all(r["metadata"]["type"] == "feel" for r in reflections)
    assert all(r["metadata"]["reflection_type"] == "dream" for r in reflections)
    assert os.path.exists(os.path.join(bucket_mgr.feel_dir, "dream"))


@pytest.mark.asyncio
async def test_dream_reflections_filter_by_influence_type(bucket_mgr):
    tone = await bucket_mgr.create_dream_reflection(
        content="Tone reflection",
        influence_type="tone",
    )
    await bucket_mgr.create_dream_reflection(
        content="Unresolved reflection",
        influence_type="unresolved",
    )

    reflections = await bucket_mgr.list_dream_reflections(influence_type="tone")

    assert [r["id"] for r in reflections] == [tone]
    assert reflections[0]["metadata"]["influence_type"] == "tone"


@pytest.mark.asyncio
async def test_regular_feel_does_not_mix_into_dream_reflections(bucket_mgr):
    feel = await bucket_mgr.create(
        content="Regular feel",
        domain=[],
        bucket_type="feel",
    )
    reflection = await bucket_mgr.create_dream_reflection(
        content="Dream reflection",
        influence_type="attention",
    )

    reflections = await bucket_mgr.list_dream_reflections()
    reflection_ids = [r["id"] for r in reflections]

    assert reflection_ids == [reflection]
    assert feel not in reflection_ids


@pytest.mark.asyncio
async def test_dream_reflection_rejects_unknown_influence_type(bucket_mgr):
    with pytest.raises(ValueError):
        await bucket_mgr.create_dream_reflection(
            content="Bad reflection",
            influence_type="mystery",
        )


@pytest.mark.asyncio
async def test_tone_dream_reflections_keep_latest_three(bucket_mgr):
    created_ids = []
    for i in range(5):
        created_ids.append(
            await bucket_mgr.create_dream_reflection(
                content=f"Tone reflection {i}",
                influence_type="tone",
            )
        )

    reflections = await bucket_mgr.list_dream_reflections(influence_type="tone")
    reflection_ids = [r["id"] for r in reflections]

    assert reflection_ids == list(reversed(created_ids[-3:]))
    assert await bucket_mgr.get(created_ids[0]) is None
    assert await bucket_mgr.get(created_ids[1]) is None


@pytest.mark.asyncio
async def test_attention_dream_reflections_keep_latest_five(bucket_mgr):
    created_ids = []
    for i in range(7):
        created_ids.append(
            await bucket_mgr.create_dream_reflection(
                content=f"Attention reflection {i}",
                influence_type="attention",
            )
        )

    reflections = await bucket_mgr.list_dream_reflections(influence_type="attention")
    reflection_ids = [r["id"] for r in reflections]

    assert reflection_ids == list(reversed(created_ids[-5:]))
    assert await bucket_mgr.get(created_ids[0]) is None
    assert await bucket_mgr.get(created_ids[1]) is None


@pytest.mark.asyncio
async def test_unresolved_dream_reflections_are_not_pruned(bucket_mgr):
    created_ids = []
    for i in range(8):
        created_ids.append(
            await bucket_mgr.create_dream_reflection(
                content=f"Unresolved reflection {i}",
                influence_type="unresolved",
            )
        )

    reflections = await bucket_mgr.list_dream_reflections(
        limit=20,
        influence_type="unresolved",
    )
    reflection_ids = [r["id"] for r in reflections]

    assert reflection_ids == list(reversed(created_ids))
