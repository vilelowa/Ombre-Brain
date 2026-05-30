import sys
import types

import pytest

from bucket_manager import BucketManager


class FakeMCP:
    def __init__(self, *args, **kwargs):
        pass

    def tool(self, *args, **kwargs):
        return lambda func: func

    def custom_route(self, *args, **kwargs):
        return lambda func: func


class FakeDecayEngine:
    async def ensure_started(self):
        return None


class FakeDreamDehydrator:
    def __init__(self):
        self.seen_material_ids = []

    async def dream_reflect(self, materials):
        self.seen_material_ids = [m["id"] for m in materials]
        return {
            "content": "I notice a warmer steadiness forming in how I hold this thread.",
            "influence_type": "tone",
            "source_bucket_ids": self.seen_material_ids,
            "valence": 0.8,
            "arousal": 0.35,
            "name": "warmer-steadiness",
        }


def import_server_with_fake_mcp(monkeypatch):
    fastmcp_module = types.ModuleType("mcp.server.fastmcp")
    fastmcp_module.FastMCP = FakeMCP
    monkeypatch.setitem(sys.modules, "mcp", types.ModuleType("mcp"))
    monkeypatch.setitem(sys.modules, "mcp.server", types.ModuleType("mcp.server"))
    monkeypatch.setitem(sys.modules, "mcp.server.fastmcp", fastmcp_module)

    import server

    return server


@pytest.mark.asyncio
async def test_dream_generates_reflection_from_flagged_candidates(test_config, monkeypatch):
    server = import_server_with_fake_mcp(monkeypatch)
    bucket_mgr = BucketManager(test_config)
    fake_dehydrator = FakeDreamDehydrator()

    source_id = await bucket_mgr.create(
        content="A marked moment with enough emotional weight to dream on.",
        domain=["关系"],
        bucket_type="dynamic",
    )
    await bucket_mgr.update(source_id, dream_candidate=True)

    monkeypatch.setattr(server, "bucket_mgr", bucket_mgr)
    monkeypatch.setattr(server, "dehydrator", fake_dehydrator)
    monkeypatch.setattr(server, "decay_engine", FakeDecayEngine())

    result = await server.dream()

    reflections = await bucket_mgr.list_dream_reflections(influence_type="tone")
    source = await bucket_mgr.get(source_id)

    assert "已从已标记的做梦素材生成 dream reflection" in result
    assert fake_dehydrator.seen_material_ids == [source_id]
    assert len(reflections) == 1
    assert reflections[0]["content"] == "I notice a warmer steadiness forming in how I hold this thread."
    assert reflections[0]["metadata"]["source_bucket_ids"] == [source_id]
    assert source["metadata"]["dream_candidate"] is False
