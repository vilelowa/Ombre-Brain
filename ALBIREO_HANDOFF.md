# Albireo PWA Handoff

Date: 2026-06-07

This handoff is for continuing the Albireo migration in the existing React/Vite PWA. Do not continue from the old `Chat.tsx` visual layout. The new interface lives under `app/src/albireo`.

## Where To Continue

Run and preview the PWA from:

```bash
cd /Users/kaikichen/Documents/Ombre-Brain/app
npm run dev
```

Open:

```text
http://localhost:3000/?albireo=1
```

Albireo is currently gated in `app/src/App.tsx`:

- Default app path still renders the old `Layout` / old pages.
- `?albireo=1` or `#albireo` renders `AlbireoApp`.
- Keep this temporary gate unless the user explicitly asks to switch the app permanently.

Backend is the existing `server.py` on `http://localhost:8000`. Do not invent backend APIs. Folder, conversation, persona, chat, SSE, and dream-candidate APIs already exist in `server.py`.

## Current State

Phase 1 created the Albireo mock shell.

Phase 2 wired Proximity to live chat infrastructure:

- Conversation list loads from `/api/conversations`.
- Message history loads from `/api/conversations/{conversation_id}/messages`.
- Chat sends through `POST /api/chat`.
- Streaming is via `EventSource` on the returned `event_stream`.
- SSE events currently handled include `context`, `core_done`, `breath_done`, `dream_done`, `feel_done`, `thinking_token`, `token`, `message_done`, `done`, and `error`.
- Persona profiles load from `/api/persona-profiles`.
- Persona switching posts to `/api/persona`.
- Quick edit saves with `PUT /api/persona-profiles/{id}`.
- Dream flagging uses `POST /api/dream-candidate/from-message`.
- Folder management is now wired to existing folder APIs.

Phase 3 built the Liminal Room (Awake State) UI and integrated its APIs:

- Created `LiminalRoom.tsx` as the main hub with high-transparency glassmorphism.
- Added `Awaken Anchors`, `Sleep Window`, `Awaken Logs` (with timeline), and `Private Diary` views.
- Implemented `LiminalSettingsModal.tsx` to configure the engine (`anchors`, `wake_limits`, `dice`, etc).
- Implemented `LiminalDiaryArchive.tsx` to view diary history, including live countdowns for time-locked entries.
- Connected APIs in `api.ts` (`getAwakeningStatus`, `getAwakeningLog`, `configureAwakening`, `getPrivateDiary`).

Phase 4 built the Nocturne Room (Sleep State) UI:

- Created `NocturneRoom.tsx` to display active Dreams and Dream Candidates.
- Added `NocturneArchive.tsx` to view the historical archive of completed dreams.
- Integrated dream APIs (`getDreams`, `getDreamCandidates`, etc).

Do not touch old `app/src/components/Chat.tsx` or old `app/src/components/Layout.tsx` for Albireo work.

## Important Files

### App Entry

`app/src/App.tsx`

- Temporary Albireo preview gate.
- `?albireo=1` / `#albireo` renders `AlbireoApp`.

### Albireo Shell

`app/src/albireo/AlbireoApp.tsx`

- Top-level Albireo app wrapper.

`app/src/albireo/AlbireoShell.tsx`

- 3-room horizontal swipe shell.
- Bottom 3-dot room indicator.
- Hosts Proximity, Undertow, and Marginalia.

`app/src/albireo/shared/roomTypes.ts`

- Room metadata for the 3-room shell.

`app/src/albireo/shared/albireoTokens.ts`

- Local visual tokens for Albireo.
- Keep new Albireo styling self-contained here where possible.

`app/src/albireo/shared/haptics.ts`

- Small browser-safe haptic helper.

### Rooms

`app/src/albireo/rooms/ProximityRoom.tsx`

- Live chat room.
- Owns drawer open state, persona menu open state, quick-edit modal state.
- Calls `useChatController`.
- Wires `ChatMessageList`, `ChatComposer`, `PersonaPicker`, `QuickEditDirective`, and `AlbireoDrawer`.

`app/src/albireo/rooms/UndertowRoom.tsx`

- Gateway to Liminal and Nocturne modes.
- Renders `LiminalRoom` and `NocturneRoom` conditionally.

`app/src/albireo/rooms/LiminalRoom.tsx`

- Awake state dashboard displaying anchors, sleep window, logs, and diaries.
- Highly transparent glassmorphic UI overlaying the background image (`/undertow/Liminal_bg.PNG`).
- Uses gentle scale/fade animations instead of shared `layoutId` morphing.

`app/src/albireo/rooms/LiminalSettingsModal.tsx`

- Modal to configure `AwakeningSchedulerConfig`.
- Calls `api.configureAwakening`.

`app/src/albireo/rooms/LiminalDiaryArchive.tsx`

- Full-screen archive for private diary entries.
- Time-locked entries show a lock icon with a live 1-minute countdown mechanism.

`app/src/albireo/rooms/NocturneRoom.tsx`

- Sleep state dashboard displaying active Dreams and Dream Candidates.
- Allows user to interact with candidates and view current dream status.

`app/src/albireo/rooms/NocturneArchive.tsx`

- Full-screen archive for completed historical dreams.

`app/src/albireo/rooms/MarginaliaRoom.tsx`

- Placeholder only.
- Do not build deeper unless user requests Marginalia/Reading phase.

### Live Chat Controller

`app/src/albireo/chat/useChatController.ts`

- Central live state and actions for Proximity.
- Loads conversations, folders, persona profiles, and selected conversation history.
- Sends messages via `api.createChat`.
- Opens SSE via `api.openChatEvents`.
- Accumulates assistant `token` content and `thinking_token` reasoning.
- Handles `message_done` and `done`.
- Exposes drawer actions:
  - `createFolder`
  - `renameConversation`
  - `moveConversationToFolder`
  - `deleteConversation`
- Exposes chat actions:
  - `sendMessage`
  - `selectConversation`
  - `startNewConversation`
  - `selectPersona`
  - `saveQuickEdit`
  - `flagDream`

### Chat UI

`app/src/albireo/chat/ChatMessageList.tsx`

- Scrollable message list.
- Adds cross-day dividers.
- Adds scroll-to-bottom button.
- Uses larger top padding so the first message is not clipped by the transparent header/blur.

`app/src/albireo/chat/ChatMessageTurn.tsx`

- Renders one message turn.
- Shows message time as `HH:MM`, not full ISO timestamp.
- Click message to show copy / flag / regen controls.
- Flag button calls `onFlagDream`.

`app/src/albireo/chat/SplitMessage.tsx`

- Renders assistant message content.
- Uses system/sans font now because Chinese looked bad in serif.
- Splits assistant content if split mode is enabled.

`app/src/albireo/chat/ThinkingBlock.tsx`

- Collapsible reasoning display for `thinking_token` / `assistant_reasoning`.

`app/src/albireo/chat/ChatComposer.tsx`

- Live composer.
- Sends via `onSend`.
- Text state comes from `useChatController`.
- Split pill toggles split mode.
- Left pill currently toggles `relayEnabled` and shows active persona name.

Important follow-up: the user noticed that after clicking the left pill near Split, chat worked again. Current code gives that pill a clickable selected state because it toggles relay/context inheritance. Confirm whether this is intended. If this pill should only display persona/model text, remove `onClick`, selected styling, and haptic feedback. If relay toggle is still needed, make its function visually clear.

`app/src/albireo/chat/PersonaPicker.tsx`

- Right-top persona dropdown.
- Persona button in Proximity header only shows icon; dropdown still shows list and quick edit action.

`app/src/albireo/chat/QuickEditDirective.tsx`

- Quick edit modal for active persona base prompt.
- Saves through controller/API.

### Drawer

`app/src/albireo/AlbireoDrawer.tsx`

- Live drawer / sidebar.
- Loads conversations and folders through props from controller.
- Supports:
  - New chat
  - Search
  - Create folder modal
  - Folder sections
  - Drag conversation into folder
  - Long press or right click conversation to edit title and move folder
  - Hover date changes into delete button
- Uses real APIs through controller callbacks.

Current UI issues to fix next:

1. Conversation list item font is too large. It should be smaller than folder/section headers. The screenshot shows conversation titles competing visually with `Conversations`.
2. Edit conversation modal folder dropdown uses native `<select>`, causing a bright white/blue platform dropdown in dark UI. Replace with a custom subtle dropdown, or style carefully if native select is kept.
3. In the same modal, the dropdown arrow is too close to the right edge. Add right padding / custom chevron positioning.

### API / Types

`app/src/lib/api.ts`

- Existing API wrapper.
- Recently added/wired:
  - `getFolders`
  - `createFolder`
  - `updateFolder`
  - `deleteFolder`
  - `moveConversationToFolder`
  - `renameConversation`
  - `flagMessageAsDreamCandidate`
  - `getPersonaProfiles`
  - `updatePersonaProfile`
  - `updatePersona`
  - `getAwakeningStatus`
  - `getAwakeningLog`
  - `triggerAwakening`
  - `configureAwakening`
  - `getPrivateDiary`
  - SSE support for `thinking_token` and `cache_stats`
- `getChatEvents` maps backend `created_at` or `timestamp` into frontend `createdAt`. This fixed awakening/push messages being displayed as current time.

`app/src/types.ts`

- Shared frontend types.
- Important additions:
  - `Message.reasoning`
  - `Message.attachments`
  - `Message.metadata`
  - `Conversation.folder_id`
  - `ConversationFolder`
  - `PersonaProfile`
  - extended `ChatEventType` for `thinking_token` and `cache_stats`

## SSE / Loading Issue Investigation

The user saw a message stuck in `Listening...`. I investigated with direct backend calls.

Result: backend and OpenRouter key/model were working at test time.

Test performed:

```bash
curl -X POST http://localhost:8000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"test","persona":"elroy-default"}'
```

Backend returned a new `conversation_id` and `event_stream`.

Then:

```bash
curl -N http://localhost:8000/api/chat/<conversation_id>/events
```

SSE successfully returned:

- `message_received`
- context events
- `token`
- `message_done`
- `done`

The assistant response was saved in history.

Interpretation:

- The backend itself is capable of completing chat.
- OpenRouter key/model are not generally broken.
- The earlier stuck `Listening...` state likely happened because the frontend POST saved the user message, but the frontend did not successfully complete the EventSource stream afterward.
- In this backend design, `POST /api/chat` writes the user message and stores a pending `_chat_sessions[conversation_id]`. Assistant generation starts when `/events` is consumed. If the browser HMR reloads, EventSource fails, or route/component state interrupts stream consumption, the conversation can be left with only the user message and no assistant.

Update from user after investigation:

- User tried again and chat worked.
- Difference they noticed: they clicked the pill left of `Split`.
- That pill currently toggles relay/context inheritance. Investigate whether toggling relay changed `parent_id` behavior or merely coincided with a clean EventSource run.

Recommended next SSE work:

1. Add temporary frontend diagnostics around `api.openChatEvents`:
   - log event stream URL
   - log each SSE event name
   - log `source.onerror`
   - log `done` close
2. Show a visible transient error if EventSource fails while `isSending`.
3. Consider a recovery path:
   - if send is stuck and `activeConversationId` exists, allow reload history or reconnect to `/events` if a pending session still exists.
4. Check whether Vite HMR caused the old stuck run during development.

## Backend APIs Verified For Drawer

Existing server routes in `server.py`:

- `GET /api/folders`
- `POST /api/folders`
- `PUT /api/folders/{folder_id}`
- `DELETE /api/folders/{folder_id}`
- `PUT /api/conversations/{conversation_id}/folder`
- `GET /api/conversations`
- `GET /api/conversations/{conversation_id}/messages`
- `DELETE /api/conversations/{conversation_id}`
- `PUT /api/chat/{conversation_id}/title`

Use these, do not add duplicate routes.

## Known Current UX Issues

The user specifically wants these addressed next:

1. Conversation list item font should be smaller than folder headers.
2. Edit conversation folder dropdown:
   - arrow is too far right
   - native dropdown colors are wrong in dark UI
   - replace with custom subtle dropdown if possible.
3. Composer left pill:
   - currently toggles relay and gives selected feedback
   - user is unsure whether it has a real function
   - check whether it should remain interactive
   - if not, make it display-only and remove click/selected feedback.

Additional prior UX context:

- Do not resume fighting header blur unless asked.
- Composer visual was considered acceptable before this handoff; avoid redesigning it unnecessarily.
- Header should stay minimal: two icon buttons, no solid header bar.
- Undertow/Marginalia remain placeholders for now.

## Verification Already Run

Frontend:

```bash
cd app
npm run lint
npm run build
```

Both passed after the current Albireo changes.

Browser:

- `http://localhost:3000/?albireo=1` rendered successfully after reload.
- Message history loaded; page did not remain on `Loading history...`.

Backend:

- `/api/conversations` reachable.
- `/api/persona-profiles` reachable.
- Direct chat + SSE test succeeded.

## Caution

The repo currently has many unrelated dirty files outside Albireo. Do not revert unrelated changes. In particular, old `app/src/components/Chat.tsx` and `app/src/components/Layout.tsx` were already dirty from earlier work; do not use them as the Albireo visual source.

