# Whiteboard — Rules for Claude Code

Clean aesthetic whiteboard with AI capabilities at **greatlibrary.ai**.

## The Operator

Maz (MAZMS). Solo founder. Works fast, thinks visually, delegates everything.

- "Do it" means DO IT. No clarification needed.
- After every meaningful change: **commit + push to main**.
- Railway auto-deploys from main. Check `railway logs` if it crashes.

## Architecture

```
whiteboard/
├── server.js          # Express server — board CRUD, AI image gen, web capture
├── db.js              # Postgres pool + schema init
├── public/
│   └── index.html     # Whiteboard — canvas, toolbar, modals, board persistence
├── package.json       # express, openai, pg — no build step
└── CLAUDE.md          # This file
```

**Key routes in server.js:**
- `GET/POST /api/boards` — list/create boards
- `GET/PATCH/DELETE /api/boards/:id` — get/update/delete a board
- `POST/PUT/DELETE /api/boards/:boardId/elements` — element CRUD + bulk save
- `POST /api/ai/generate-image` — DALL-E 3 image generation
- `POST /api/ai/capture-image` — fetch image from URL (proxy)
- `POST /api/ai/search-images` — image search
- `GET /health` — health check

**Database tables (Postgres on Railway):**
- `boards` — id, name, timestamps
- `elements` — id, board_id, type, x, y, width, height, data (JSONB), z_index
- `images` — id, board_id, source, url, prompt, dimensions

## Invariants

1. **No build step.** Plain HTML + CSS + vanilla JS in `public/`. No React, no bundler.
2. **Clean light theme by default.** Dark mode via `[data-theme="dark"]`.
3. **Secrets in `process.env` only.** Never commit, log, or echo API keys.
4. **All board data persists to Postgres.** Auto-save after 3 seconds of inactivity.
5. **Inter font family.** Clean sans-serif. Monospace only for code.
6. **New env var → add to `.env.example`** in the same commit.

## Design Rules

- Clean, minimal, lots of whitespace
- Frosted glass toolbar with backdrop-filter blur
- Subtle shadows, smooth transitions (cubic-bezier)
- No visible scrollbars
- Mobile responsive at 640px breakpoint
- Touch targets >= 44px
- Keyboard shortcuts for all tools (V, P, T, N, S, E, I, W)

## Board Element Types

- **text** — contenteditable text on canvas
- **note** — sticky note with textarea
- **image** — AI-generated or web-captured image
- **shape** — rect or circle, toggleable
- **drawing** — freehand pen strokes (rendered on canvas)

## Railway Deployment

- Domain: **greatlibrary.ai**
- Project: `greatlibrary.ai` on Railway
- Service: `web` (Node.js)
- Database: `Postgres-GTto` (internal connection)
- Auto-deploys on push to `main`
- Env vars: `DATABASE_URL`, `OPENAI_API_KEY`
