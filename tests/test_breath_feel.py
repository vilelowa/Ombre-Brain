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


@pytest.mark.asyncio
async def test_breath_domain_feel_retrieves_dream_reflections(test_config, monkeypatch):
    import sys
    import types

    fastmcp_module = types.ModuleType("mcp.server.fastmcp")
    fastmcp_module.FastMCP = FakeMCP
    monkeypatch.setitem(sys.modules, "mcp", types.ModuleType("mcp"))
    monkeypatch.setitem(sys.modules, "mcp.server", types.ModuleType("mcp.server"))
    monkeypatch.setitem(sys.modules, "mcp.server.fastmcp", fastmcp_module)

    import server

    bucket_mgr = BucketManager(test_config)
    reflection_id = await bucket_mgr.create_dream_reflection(
        content="A dream reflection that should surface as feel.",
        influence_type="tone",
    )

    monkeypatch.setattr(server, "bucket_mgr", bucket_mgr)
    monkeypatch.setattr(server, "decay_engine", FakeDecayEngine())

    result = await server.breath(domain="feel")

    assert "=== 你留下的 feel ===" in result
    assert f"[bucket_id:{reflection_id}]" in result
    assert "A dream reflection that should surface as feel." in result
