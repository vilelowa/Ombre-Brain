# Elroy / Ombre Brain Design

This document captures the current backend design and the API shape that the
PWA should build against. It is an engineering handoff, not a product manifesto.

## System Shape

Elroy currently runs as one backend process with two adapter surfaces:

- MCP tools for Claude/local agent use.
- HTTP + SSE routes for the future PWA.

Both surfaces share the same runtime objects:

- `bucket_mgr`
- `dehydrator`
- `embedding_engine`
- `decay_engine`

This keeps memory state, dream generation, and decay behavior consistent across
Claude and the PWA.

Planned deployment shape:

```text
Netlify PWA
  -> HTTP/SSE over Tailscale
Mac backend
  -> server.py FastMCP app with custom HTTP routes
  -> Ombre Brain bucket storage
  -> future scheduler / awakening loop
  -> future Web Push sender
```

The PWA should not speak MCP directly. MCP remains the local tool protocol;
the PWA talks to REST/SSE routes.

## Memory Layers

### Core

Stored under:

```text
permanent/core/
```

Core is identity/relationship/commitment material. It is read directly with
`core()` / `BucketManager.render_core_context()` and does not participate in:

- normal `list_all()` output
- search
- decay
- dream candidate selection

Core promotion is intentionally not automatic yet.

### Dynamic / Episodic

Normal memory buckets live under `dynamic/`. These are surfaced by `breath()`
and can be searched by query/domain/emotion.

### Feel

Feel buckets live under:

```text
feel/
```

Dream reflections specifically live under:

```text
feel/dream/
```

`breath(domain="feel")` is a special retrieval channel and must run before the
normal empty-query surfacing branch. It returns feel entries, including dream
reflections.

## Startup Context Chain

The conversation startup chain is:

```text
core()
  -> breath()
  -> dream()
  -> breath(domain="feel")
  -> start speaking
```

Current HTTP bridge exposes this through:

```text
GET /api/context/startup
```

and uses the same chain inside:

```text
POST /api/chat
GET /api/chat/{conversation_id}/events
```

## Dream Pipeline

Current v1 behavior:

1. Buckets can be marked with `dream_candidate=True`.
2. `dream()` prioritizes flagged candidates.
3. Flagged candidates are sent to `dehydrator.dream_reflect()`.
4. The LLM is asked to return JSON:

```json
{
  "content": "first-person dream reflection",
  "influence_type": "tone | attention | unresolved",
  "source_bucket_ids": ["..."],
  "valence": 0.5,
  "arousal": 0.3,
  "name": "optional short name"
}
```

5. Valid output is stored via `BucketManager.create_dream_reflection()`.
6. Successful generation clears `dream_candidate=False` on source buckets.
7. Failed generation preserves source flags.

Slot limits:

- `tone`: keep latest 3
- `attention`: keep latest 5
- `unresolved`: keep all for now

If there are no flagged candidates, `dream()` preserves the older fallback
behavior and returns recent material for manual introspection.

## HTTP + SSE API Contract

### Startup Context

```text
GET /api/context/startup
```

Returns:

```json
{
  "context": {
    "core": "...",
    "breath": "...",
    "dream": "...",
    "feel": "..."
  },
  "events": [
    {"event": "context", "data": {"stage": "core", "status": "started"}},
    {"event": "core_done", "data": {"stage": "core", "status": "done"}}
  ]
}
```

### Chat Create

```text
POST /api/chat
Content-Type: application/json
```

Request:

```json
{
  "message": "hello",
  "persona": "elroy-default"
}
```

Response:

```json
{
  "conversation_id": "...",
  "event_stream": "/api/chat/{conversation_id}/events",
  "status": "context_ready",
  "context": {
    "core": "...",
    "breath": "...",
    "dream": "...",
    "feel": "..."
  }
}
```

Important: A0 does not generate a real assistant message yet. It assembles and
streams context readiness. `assistant_response` is currently `null` in the final
SSE event.

### Chat Events

```text
GET /api/chat/{conversation_id}/events
Accept: text/event-stream
```

Current event types:

- `message_received`
- `context`
- `core_done`
- `breath_done`
- `dream_done`
- `feel_done`
- `error`
- `done`

Example:

```text
event: breath_done
data: {"stage":"breath","status":"done","chars":120}
```

Future token streaming should add:

- `token`
- `message_done`

without breaking the existing context events.

### Dream Log

```text
GET /api/dreams?limit=20&influence_type=tone
```

Returns newest dream reflections:

```json
[
  {
    "id": "...",
    "content": "...",
    "influence_type": "tone",
    "source_bucket_ids": ["..."],
    "valence": 0.7,
    "arousal": 0.3,
    "created": "...",
    "name": "..."
  }
]
```

### Push Subscription

```text
POST /api/push/subscribe
```

Stores a browser Push API subscription in:

```text
push_subscriptions.json
```

Request shape follows the browser Push API:

```json
{
  "endpoint": "https://...",
  "keys": {
    "p256dh": "...",
    "auth": "..."
  }
}
```

### Push Test

```text
POST /api/push/test
```

Current A0 behavior validates the route and subscription storage, but does not
send a real push notification yet. Real sending is deferred until VAPID keys and
the Web Push sender are added.

## Frontend Build Order

Recommended A-phase order:

1. PWA shell and routing.
2. Chat view connected to `/api/chat` and SSE events.
3. Startup/status display using context event states.
4. Dream Log view using `/api/dreams`.
5. Service Worker registration and push subscription UI.
6. Push test button wired to `/api/push/test`.
7. Awakening console later, after scheduler parameters exist.

The first screen should be the usable chat interface, not a landing page.

## Deferred Work

These are intentionally not done in A0:

- Real assistant response generation for `/api/chat`.
- Streaming model tokens over SSE.
- Conversation persistence.
- Persona profile storage and model switching.
- Scheduler / awakening loop.
- Real Web Push sending.
- VAPID key generation and rotation.
- Reading space / document ingestion UI.
- Core promotion workflow.

## Testing Strategy

Most backend behavior is testable without an API key:

- bucket storage
- Core listing/rendering
- dream candidate marking
- dream reflection storage and pruning
- `breath(domain="feel")`
- HTTP/SSE API shape

LLM behavior should be tested in two layers:

- Unit tests mock the LLM adapter, as in dream generation tests.
- Quality tests may call the real API, but should skip cleanly when no key is
  configured.

Current expected local pattern:

```bash
python3 -m pytest tests/
```

LLM quality tests may be skipped without `OMBRE_API_KEY`.
