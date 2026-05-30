# Elroy PWA Handoff

## Current State

Backend memory/dream work is effectively through B plus A0.

Recent backend/API milestones:

- Core layer exists under `permanent/core/`.
- Dream candidates can be flagged with `dream_candidate=True`.
- Dream reflections are stored under `feel/dream/`.
- Dream reflection slot limits are implemented:
  - `tone`: latest 3
  - `attention`: latest 5
  - `unresolved`: unbounded for now
- `breath(domain="feel")` correctly retrieves `feel/dream/`.
- `dream()` has LLM-backed v1 behavior for flagged material:
  - reads flagged buckets
  - calls `dehydrator.dream_reflect()`
  - writes `create_dream_reflection()`
  - clears `dream_candidate=False` on success
  - preserves flags on failure
- HTTP + SSE bridge exists in `server.py`.

Latest verified backend test run before this handoff:

```text
62 passed, 7 skipped
```

Command:

```bash
python3 -m pytest tests/
```

## Design Docs Added

### `DESIGN.md`

Engineering design doc for backend/PWA architecture:

- MCP + HTTP/SSE bridge shape
- memory layers
- startup chain
- dream pipeline
- REST/SSE API contract
- deferred work
- testing strategy

### `PWA_DESIGN.md`

Visual/interaction brief for Stitch or frontend design work:

- mobile-first PWA direction
- Chat / Dreams / Awake / Settings
- visual language
- context readout
- dream timeline
- push setup states

## Backend HTTP/SSE API

Implemented in `server.py` via FastMCP custom routes, not a separate FastAPI app.

Current endpoints:

```text
GET  /api/context/startup
POST /api/chat
GET  /api/chat/{conversation_id}/events
GET  /api/dreams
POST /api/push/subscribe
POST /api/push/test
```

Important note:

`POST /api/chat` currently assembles startup context and provides an SSE stream,
but does not yet generate real assistant text. The final SSE event has
`assistant_response: null`.

## PWA App State

There is now an `app/` directory, apparently generated from Stitch / AI Studio.

Files of interest:

```text
app/src/App.tsx
app/src/components/Layout.tsx
app/src/components/Chat.tsx
app/src/components/Dreams.tsx
app/src/components/Awake.tsx
app/src/components/Settings.tsx
app/src/lib/api.ts
app/src/types.ts
app/src/index.css
app/.env.example
```

The visual shell is already close to `PWA_DESIGN.md`:

- Chat default screen
- Dreams timeline
- Awake status/control screen
- Settings diagnostics
- mobile bottom tabs
- desktop left rail

## PWA API Client Work Done

`app/src/lib/api.ts` was converted from mock-only to a real HTTP/SSE client.

It now supports:

- `VITE_API_BASE_URL`
- `getStartupContextDetails()` -> `GET /api/context/startup`
- `createChat()` -> `POST /api/chat`
- `openChatEvents()` -> `EventSource`
- `getDreams()` -> `GET /api/dreams`
- `subscribePush()` -> `POST /api/push/subscribe`
- `testPush()` -> `POST /api/push/test`

Compatibility shims remain so existing UI does not immediately break:

- `getStartupContext()` returns all stages as `done` after fetching details.
- `sendMessage()` calls `createChat()` but returns a local user message.
- `getChatEvents()` returns `[]`.
- `generateAssistantResponse()` returns a system placeholder:
  `Context is ready. Assistant response generation is not wired yet.`

`app/src/types.ts` was updated with:

- backend response types
- SSE event types
- `Dream.name`
- `Dream.sourceBucketIds`
- `ContextState = pending | running | done | error`

`app/src/vite-env.d.ts` was added for `VITE_API_BASE_URL`.

`app/.env.example` now contains:

```text
VITE_API_BASE_URL="http://localhost:8000"
```

## Important Git / Workspace Notes

At the time this handoff was written, likely untracked/dirty files include:

```text
DESIGN.md
PWA_DESIGN.md
PWA_HANDOFF.md
app/
elroy_project_plan_1 copy.md
.DS_Store
```

Do not commit `.DS_Store`.

`elroy_project_plan_1 copy.md` was already untracked before the PWA work; decide
explicitly whether to keep it.

## npm / Verification Status

Earlier, the shell had no npm/pnpm/yarn. The user later said npm is installed.

Next agent should verify:

```bash
cd app
npm install
npm run lint
npm run build
```

If dependencies are already installed, skip `npm install` and run:

```bash
npm run lint
npm run build
```

## Recommended Next Step

Do **A1: wire Chat UI to real SSE events**.

Target files:

```text
app/src/components/Chat.tsx
app/src/lib/api.ts
app/src/types.ts
```

Suggested behavior:

1. On mount:
   - show startup context readout as pending/running
   - optionally call `getStartupContextDetails()`
   - update `core/breath/dream/feel` states from returned events

2. On send:
   - append local user message immediately
   - call `api.createChat(text)`
   - open `api.openChatEvents(event_stream, onEvent)`
   - update context readout from SSE events:
     - `context`: stage started/running
     - `core_done`
     - `breath_done`
     - `dream_done`
     - `feel_done`
     - `error`
     - `done`

3. Since real assistant generation is not wired yet:
   - do not fake an assistant reply as if it were real
   - show a quiet system/status message like:
     `Context ready. Assistant generation is not wired yet.`

4. Close the `EventSource` on:
   - `done`
   - error
   - component unmount

After Chat is wired:

1. Wire `Dreams.tsx` to the real `api.getDreams()` output. It may already work
   because `api.getDreams()` maps backend fields to current UI fields.
2. Update `Settings.tsx` backend URL from fake `wss://api.elroy.app/v1` to
   `VITE_API_BASE_URL` / same-origin.
3. Clean AI Studio template leftovers:
   - `app/README.md`
   - package name
   - unused dependencies such as `@google/genai`, `express`, `dotenv` if build
     confirms they are unused.

## Backend Run Reminder

For local HTTP/SSE routes, backend should run with HTTP transport, e.g.:

```bash
OMBRE_TRANSPORT=streamable-http python3 server.py
```

Then app env should point to:

```text
VITE_API_BASE_URL="http://localhost:8000"
```

For phone/PWA testing over Tailscale, use the Mac's Tailscale URL instead.
