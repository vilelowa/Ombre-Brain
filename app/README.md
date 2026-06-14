# Albireo PWA Frontend

Albireo is the mobile-first Progressive Web App for Ombre Brain, built with React, Vite, TypeScript, and Lucide Icons.

## Features

- **Proximity**: Live chat, SSE reasoning, personas, conversations, folders, and dream flagging.
- **Undertow**: Memories, dreams, calendar traces, awakening controls, and private diary.
- **Marginalia**: Bookshelf, reader, bookmarks, notes, and reading progress.
- **Meridian**: Persona, model, storage, diagnostics, token statistics, and Web Push controls.

## Development

### Running Locally

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment**:
   Make sure you have your `.env` configured. Create `app/.env` (or copy `.env.example`) and set:
   ```env
   VITE_API_BASE_URL="http://localhost:8000"
   ```

3. **Start the Vite dev server**:
   ```bash
   npm run dev
   ```

### Formatting and Building

- **Lint**: `npm run lint`
- **Build**: `npm run build`
