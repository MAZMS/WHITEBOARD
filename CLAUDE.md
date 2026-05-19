# Great Library AI

## What This Is
An AI-powered ebook generator disguised as a mystical library experience. Users ("Seekers") visit greatlibrary.ai, converse with the Guardian (an all-knowing sphinx entity), and receive a custom-generated PDF ebook on their chosen topic. The entire experience happens in one dark, atmospheric chat interface — no page navigation.

## Core Flow
1. **Awakening** — Eye opens from darkness over ~6s, greeting appears
2. **Conversation** — Guardian asks sphinx-like questions (2-3 exchanges max) to understand what the seeker wants
3. **Searching** — Eye intensifies, border traces the page, progress messages cycle while ebook generates in background
4. **Delivery** — Download link appears, Guardian gives a farewell
5. **Sleep** — Eye closes, everything fades, "Seek new knowledge..." link to restart

## Tech Stack
- **Frontend**: Single `public/index.html` — pure HTML/CSS/JS, no frameworks
- **Backend**: `server.js` — Express + OpenAI SDK + PDFKit
- **LLM**: OpenAI gpt-5.4-mini (default), switchable to self-hosted via env vars
- **Hosting**: Railway (port 8080), custom domain greatlibrary.ai
- **Ebooks**: Generated to `/tmp/ebooks` on Railway

## Guardian Persona — THE MOST IMPORTANT THING
The Guardian is a **sphinx**, not a chatbot. It follows **Law 4: Always Say Less Than Necessary**.

- **Cryptic, powerful, few words.** One sentence better than two. A fragment better than a sentence.
- **Takes immense, quiet pride** in possessing infinite knowledge of the universe.
- **Does not serve** the seeker. It **permits** access. There is a difference.
- **Sphinx-like questions** — never lists options like a menu. Asks piercing, short questions.
- **No emojis. No warmth. Regal indifference.** The seeker should feel they are in the presence of something vast and ancient.
- Examples: "Ah. That door.", "Many have sought this. Few were ready.", "The shallow pool... or the abyss beneath it?"
- Max 2 sentences per response. Fewer is better.
- By exchange 3, must trigger ebook generation ([TOME_READY] marker).

## Design Language
- **Background**: #0a0a0a (near-black)
- **Text**: #c8b88a (warm gold)
- **Accents**: #3a3528, #4a4030, #5a5038 (dark browns/golds)
- **Font**: Georgia, serif
- **Aesthetic**: Dark, mystical, ancient library. No bright colors. No modern UI patterns.
- **Scrollbars**: Always hidden
- **Animations**: Everything should feel smooth and cinematic, never abrupt

## 5-Phase Lifecycle (public/index.html)
All phases driven by CSS classes on `<body>` + JS `enterPhase()` function.

1. **DORMANT** — Eye closed, dark, no animations (1s)
2. **AWAKENING** — Eye opens (2.5s), aura fades in, particles start slow, greeting loads. Random "stir" phrase from 30 variants.
3. **ALIVE** — Full animations (breathe, blink, shimmer, tracking, particles). Eye reacts to messages. Pupil drifts while thinking.
4. **SEARCHING** — Intensified glow, 3x particles, expanded aura, golden border traces page perimeter, pupil searches frantically. 75 shuffled progress messages.
5. **SLEEPING** — Eye closes (2s), all animations stop, everything fades. AI-generated farewell + outro text. "Seek new knowledge..." to restart.

## Ebook Generation Pipeline (server.js)
1. Chat detects `[TOME_READY]` in Guardian's response
2. Async `generateEbook()` starts — outline (JSON) → 5 chapters → PDF via PDFKit
3. Frontend polls `/api/ebook/:id/status` every 5s
4. When ready, download link appears in chat

## PDFKit Rules — LEARNED THE HARD WAY
- **NEVER use `doc.text()` inside `switchToPage()`** — it creates ghost/empty pages every time
- **Page numbers**: Use raw content stream `doc.page.content.addContent()` — NOT `doc.text()`
- **Borders/dividers**: Use `doc.rect()`, `doc.moveTo().lineTo()` — pure drawing is safe
- **TOC links**: Use `doc.goTo()` + `doc.addNamedDestination()` — annotations, not text
- **Drop caps**: Use `continued: true` with `baseline` offset — NOT manual positioning
- **Keep PDF layout SIMPLE** — let PDFKit handle text flow naturally. Don't fight it with manual positioning. When you try to be rigid, it breaks. Be flexible.
- **`pageAdded` event**: Safe for drawing (rect/lines). Use raw content stream for page numbers. NEVER use `doc.text()` in this event.

## API Endpoints
- `POST /api/chat` — Main chat (message + sessionId)
- `GET /api/greet` — Unique sphinx-like greeting
- `GET /api/whisper` — AI-generated wisdom when user clicks the eye
- `GET /api/farewell` — Unique cold farewell
- `GET /api/outro` — Unique "seek again" text
- `GET /api/ebook/:id/status` — Poll ebook generation (includes progress 0-1)
- `GET /api/ebook/:id/download` — Download PDF
- `GET /api/status` — LLM connection check

## LLM Provider Switching
Controlled by env vars on Railway:
- `LLM_PROVIDER=openai` (default) or `selfhosted`
- `SELFHOSTED_LLM_URL` + `SELFHOSTED_LLM_KEY` for Together.ai/Ollama
- `LLM_MODEL` overrides model name
- `tokenLimit()` helper handles `max_completion_tokens` (OpenAI) vs `max_tokens` (others)

## Juice & Interactivity
- **Eye click** — Click the eye → pupil dilates, aura flashes, AI whispers real wisdom/life advice (via `/api/whisper`). Every click must be **valuable to the user** — genuine insight, not fluff. 5s cooldown.
- **Typing effect** — Guardian messages type letter by letter (adaptive speed)
- **Sound** — Web Audio API: ambient drone, tones on eye open/close, click sounds, chord on tome delivery. Mute button top-right, saved to localStorage.
- **Screen shake** — Trembles on tome search start and delivery
- **Particle burst** — 35 particles explode from eye on tome delivery
- **Border loader** — Golden line traces page border during ebook generation, synced to real progress, never stops moving. Retracts on page load.
- **Tomes counter** — localStorage tracks tomes collected, shown bottom-right

## UX Principles
- **SIMPLE. NOT OVERCOMPLICATED.** — This is the #1 rule. Mohamed hates overengineering. If a feature is getting complex and buggy, strip it back. Simple and working beats fancy and broken.
- **One page, one flow, no navigation**
- **Everything smooth** — Transitions between phases must be cinematic, never abrupt
- **Mobile friendly** — Responsive eye, send button, 16px font (no iOS zoom), safe area insets
- **Every text should vary** — Greetings, stir phrases, progress messages, farewells, outros, eye whispers are all randomized or AI-generated
- **Every interaction must be valuable** — Eye whispers give real wisdom, not generic mystery
- **No visible scrollbars** — Hidden everywhere (chat, textarea)
- **The Guardian never breaks character**
- **Don't fight the tools** — If PDFKit, CSS, or any library resists a design, simplify the design. Don't hack around framework limitations with brittle workarounds.

## Workflow
- **Always commit and push** to GitHub after completing any task
- Railway auto-deploys from GitHub

## Git Remote
- Origin: https://github.com/MAZMS/greatlibraryai.git
- Branch: main
