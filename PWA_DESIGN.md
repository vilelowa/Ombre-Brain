# Elroy PWA Visual Design Brief

Use this brief to visualize the first version of the Elroy mobile PWA.
The app is not a landing page. The first screen is the actual chat experience.

## Product Feel

Elroy is a private AI companion interface for one person. It should feel quiet,
intimate, capable, and slightly alive, but not cute or decorative.

The design should feel like:

- a private notebook
- a live conversation room
- a soft system console
- a memory instrument

Avoid:

- marketing hero sections
- generic SaaS dashboards
- glossy AI chatbot tropes
- purple-blue gradient branding
- big floating cards everywhere
- orb/bokeh/space backgrounds
- mascot-style personality

The interface should be restrained, tactile, and readable. It can have warmth,
but it should not become beige lifestyle design.

## Visual Direction

Base:

- off-white or very pale warm gray background
- thin hairline borders
- subtle dotted or dashed dividers
- low-saturation accents
- compact, readable typography
- monospaced details for system/status text
- rounded corners no larger than 8px

Palette idea:

- background: warm off-white / paper gray
- text: charcoal
- secondary text: muted gray
- accent 1: muted teal or blue-green
- accent 2: dusty rose or muted coral
- warning/attention: muted amber
- unresolved: cool gray-violet, used sparingly

Do not let the whole app become one-hue beige, slate, purple, or brown.

Typography:

- primary text: clean sans-serif
- metadata/status: monospace
- no huge hero type inside the app
- chat text should be comfortable for long reading

## App Structure

Primary navigation should be small and persistent:

- Chat
- Dreams
- Awake
- Settings

On mobile, use a bottom tab bar. On desktop/tablet, a narrow left rail is fine.

The Chat tab is the default first screen.

## Screen 1: Chat

Purpose:

The central conversation space where Ciel talks with Elroy.

Layout:

- full-height app shell
- top status strip
- scrollable message timeline
- bottom composer

Top status strip:

- current persona name, e.g. `Elroy`
- small connection state: `local`, `tailscale`, or `offline`
- subtle context state indicator:
  - `breathing`
  - `dreaming`
  - `ready`
  - `thinking`

Message timeline:

- user and Elroy messages should be clearly distinguished without loud bubbles
- prefer gentle alignment, indentation, border-left accents, or subtle background shifts
- Elroy messages should support longer reflective paragraphs
- user messages can be tighter and more direct
- timestamps are quiet and optional

Composer:

- multiline input
- send icon button
- image upload icon button
- optional haptic/tactile send feedback
- disabled/loading state while sending

Context activity:

When startup or chat context is assembling, show a compact live status area:

```text
core       done
breath     done
dream      running
feel       waiting
```

This should feel like a small diagnostic readout, not a modal or tutorial.

SSE events map to UI states:

- `message_received`: composer clears, message appears
- `core_done`: startup checklist marks core done
- `breath_done`: checklist marks breath done
- `dream_done`: checklist marks dream done
- `feel_done`: checklist marks feel done
- `done`: ready for assistant response or next action

For A1, assistant response may be unavailable. The UI should gracefully show
context readiness without pretending a real reply exists.

## Screen 2: Dreams

Purpose:

A quiet log of dream reflections stored in `feel/dream/`.

Layout:

- vertical timeline
- filters by influence type:
  - All
  - Tone
  - Attention
  - Unresolved

Dream reflection item:

- influence type label
- created time
- reflection text
- source count or source bucket ids collapsed
- valence/arousal shown as tiny coordinates or small bars

Visual treatment:

- no glowing dream orb
- no cosmic background
- no mystical tarot styling
- use static timeline cards or unframed timeline rows
- subtle fade-in is okay

Influence type visual language:

- `tone`: soft warm accent
- `attention`: muted teal accent
- `unresolved`: cool gray-violet accent

Slot behavior can be implied:

- tone shows recent 3
- attention shows recent 5
- unresolved can grow

Do not explain slot rules in the UI unless there is a settings/debug view.

## Screen 3: Awake

Purpose:

Future control panel for awakening behavior. In A1/A2 this can be mostly
read-only or placeholder-backed, but it should establish the visual language.

Sections:

- today anchors:
  - 08:00
  - 12:00
  - 19:00
  - 22:00
- next wake time
- current sleep/work window
- push status
- dice threshold / contact permission state

Use dense, calm controls:

- segmented controls
- toggles
- compact time fields
- small status chips
- not large marketing cards

Push setup:

- status: `not subscribed`, `subscribed`, `test pending`, `test unavailable`
- button: icon + `Test`
- explanation should be minimal

## Screen 4: Settings

Purpose:

Local configuration and diagnostics.

Sections:

- backend URL
- connection status
- persona profile selector
- model/profile placeholder
- cache/status diagnostics
- app install status
- service worker status

This should feel like a compact settings surface, not a full admin dashboard.

## Components

Use familiar controls:

- icons for send, upload, retry, close, settings
- toggles for binary settings
- segmented controls for filters/modes
- tabs for main sections
- sliders or small numeric fields for thresholds later
- tooltips for unfamiliar icons on desktop

Avoid:

- text-only rounded buttons for icon-like actions
- nested cards
- decorative section cards
- oversized empty states

Cards are acceptable only for repeated items such as dream reflections or
message groups, with radius 8px or less.

## Motion

Motion should be subtle:

- small fade for incoming messages
- checklist state transitions
- composer send feedback
- dream timeline row fade-in

Avoid:

- bouncing assistants
- particle backgrounds
- large page transitions
- constant ambient animation

## Mobile Requirements

Design mobile-first.

Target:

- iPhone-sized viewport
- full-screen installed PWA
- no browser toolbar assumption
- bottom safe-area padding
- keyboard-aware composer
- readable long messages

The composer must never cover the latest message permanently.

## Desktop / Tablet

Desktop can use:

- narrow left rail navigation
- wider message column
- right-side context inspector only if space allows

Do not make desktop look like a generic analytics dashboard.

## Data/API Awareness

The UI should be designed around this backend shape:

```text
GET  /api/context/startup
POST /api/chat
GET  /api/chat/{conversation_id}/events
GET  /api/dreams
POST /api/push/subscribe
POST /api/push/test
```

Important current limitation:

`POST /api/chat` currently assembles context and streams readiness events. It
does not yet generate real assistant text. Design the loading/readiness state so
this limitation feels natural during development.

## Stitch Prompt Summary

Create a mobile-first PWA interface for a private AI companion named Elroy.
The first screen is a real chat app, not a landing page. Visual style is quiet,
intimate, off-white, hairline borders, subtle dotted dividers, restrained
low-saturation accents, compact typography, and small monospaced system status.

Include four tabs: Chat, Dreams, Awake, Settings. The Chat screen has a top
status strip, message timeline, bottom composer, and a compact context startup
readout showing core/breath/dream/feel states. The Dreams screen is a static
timeline of dream reflections with filters for tone, attention, unresolved. The
Awake screen is a calm control/status panel for future wake scheduling and push
subscription. Settings is a compact diagnostics/config page.

Avoid marketing layouts, giant hero sections, purple gradients, glowing orbs,
mascots, generic SaaS dashboards, and nested cards. Use subtle motion only.
