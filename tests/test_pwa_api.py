import json
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


class FakeRequest:
    def __init__(self, body=None, query_params=None, path_params=None):
        self._body = body
        self.query_params = query_params or {}
        self.path_params = path_params or {}
        self.cookies = {}

    async def json(self):
        if isinstance(self._body, Exception):
            raise self._body
        return self._body


class FakeJSONResponse:
    def __init__(self, content, status_code=200):
        self.status_code = status_code
        self.body = json.dumps(content, ensure_ascii=False).encode("utf-8")


class FakeStreamingResponse:
    def __init__(self, body_iterator, media_type=None, status_code=200):
        self.body_iterator = body_iterator
        self.media_type = media_type
        self.status_code = status_code


def import_server_with_fake_mcp(monkeypatch):
    fastmcp_module = types.ModuleType("mcp.server.fastmcp")
    fastmcp_module.FastMCP = FakeMCP
    responses_module = types.ModuleType("starlette.responses")
    responses_module.JSONResponse = FakeJSONResponse
    responses_module.StreamingResponse = FakeStreamingResponse
    monkeypatch.setitem(sys.modules, "mcp", types.ModuleType("mcp"))
    monkeypatch.setitem(sys.modules, "mcp.server", types.ModuleType("mcp.server"))
    monkeypatch.setitem(sys.modules, "mcp.server.fastmcp", fastmcp_module)
    monkeypatch.setitem(sys.modules, "starlette", types.ModuleType("starlette"))
    monkeypatch.setitem(sys.modules, "starlette.responses", responses_module)

    import server

    return server


def response_json(response):
    return json.loads(response.body.decode("utf-8"))


@pytest.mark.asyncio
async def test_chat_api_returns_sse_event_stream(monkeypatch):
    server = import_server_with_fake_mcp(monkeypatch)

    async def fake_core(max_tokens=4000):
        return "core context"

    async def fake_breath(
        query="",
        max_tokens=10000,
        domain="",
        valence=-1,
        arousal=-1,
        max_results=20,
        importance_min=-1,
    ):
        if domain == "feel":
            return "dream feel context"
        return "breath context"

    async def fake_dream():
        return "dream generated"

    monkeypatch.setattr(server, "core", fake_core)
    monkeypatch.setattr(server, "breath", fake_breath)
    monkeypatch.setattr(server, "dream", fake_dream)

    response = await server.api_chat_create(FakeRequest({
        "message": "hello Elroy",
        "persona": "test-persona",
    }))
    payload = response_json(response)

    assert payload["status"] == "context_ready"
    assert payload["event_stream"].startswith("/api/chat/")
    assert payload["context"]["core"] == "core context"
    assert payload["context"]["feel"] == "dream feel context"

    conversation_id = payload["conversation_id"]
    stream_response = await server.api_chat_events(FakeRequest(
        path_params={"conversation_id": conversation_id},
    ))
    chunks = []
    async for chunk in stream_response.body_iterator:
        chunks.append(chunk.decode("utf-8") if isinstance(chunk, bytes) else chunk)
    stream_text = "".join(chunks)

    assert "event: message_received" in stream_text
    assert "event: core_done" in stream_text
    assert "event: done" in stream_text
    assert '"status": "context_ready"' in stream_text


@pytest.mark.asyncio
async def test_dreams_api_lists_dream_reflections(test_config, monkeypatch):
    server = import_server_with_fake_mcp(monkeypatch)
    bucket_mgr = BucketManager(test_config)
    reflection_id = await bucket_mgr.create_dream_reflection(
        content="A visible dream reflection.",
        influence_type="attention",
        source_bucket_ids=["source-1"],
    )
    monkeypatch.setattr(server, "bucket_mgr", bucket_mgr)

    response = await server.api_dreams(FakeRequest())
    payload = response_json(response)

    assert payload[0]["id"] == reflection_id
    assert payload[0]["content"] == "A visible dream reflection."
    assert payload[0]["influence_type"] == "attention"
    assert payload[0]["source_bucket_ids"] == ["source-1"]


@pytest.mark.asyncio
async def test_push_subscribe_stores_subscription(test_config, monkeypatch):
    server = import_server_with_fake_mcp(monkeypatch)
    monkeypatch.setattr(server, "config", test_config)

    response = await server.api_push_subscribe(FakeRequest({
        "endpoint": "https://push.example/subscription-a",
        "keys": {"p256dh": "key", "auth": "auth"},
    }))
    payload = response_json(response)

    assert payload == {"ok": True, "subscriptions": 1}

    test_response = await server.api_push_test(FakeRequest())
    test_payload = response_json(test_response)

    assert test_payload["ok"] is True
    assert test_payload["subscriptions"] == 1
    assert test_payload["reason"] == "web_push_sender_not_configured"
