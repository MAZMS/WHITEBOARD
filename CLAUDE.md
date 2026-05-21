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
- **Frontend**: Single `public/index.html` (~3300 lines) — pure HTML/CSS/JS, no frameworks
- **Backend**: `server.js` (~1400 lines) — Express + OpenAI SDK (used for ALL text providers via OpenAI-compatible endpoints) + PDFKit
- **LLM (text)**: Gemini 2.5 Flash by default (`LLM_PROVIDER=gemini`), with OpenAI, OpenRouter, and self-hosted as alternates — all called through the OpenAI SDK
- **Image (covers)**: Gemini 2.5 Flash Image ("Nano Banana") → Imagen 3 fallback, both via Vertex AI
- **Vision (QA)**: Gemini 2.5 Flash (multimodal) reviews generated test PDFs and cover artwork
- **Auth for Google models**: `google-auth-library` — service-account token (bills to GCP credits) or API key
- **Fonts**: Bundled `.ttf` files in `fonts/`, plus on-demand Google Fonts download at PDF build time
- **Deps**: `express`, `openai`, `pdfkit`, `google-auth-library`, `dotenv`, `pdf-to-img`
- **Hosting**: Railway (port 8080), custom domain greatlibrary.ai
- **Ebooks**: Generated to `/tmp/ebooks` on Railway (when `RAILWAY_ENVIRONMENT` is set), else `./ebooks`. Job state mirrored to `jobs.json` for crash recovery.

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

## Two Guardian Modes
Selected by which provider is active (toggled via `/api/mode`):
- **Censored** (default) — `SYSTEM_PROMPT`, runs on Gemini ("The Main Hall"). Standard sphinx.
- **Uncensored** — `SYSTEM_PROMPT_UNCENSORED`, runs on OpenRouter (Hermes, "The Forbidden Wing"). No content restrictions, no disclaimers. `isUncensoredProvider()` returns true for `openrouter`/`selfhosted` and switches both the chat prompt AND the ebook prompts (adds an uncensored note). The frontend shifts atmosphere (red eye glow, lower drone pitch, screen shake) when toggled.
- **Note**: chat + chapter text honor the active (possibly uncensored) provider, but the *design* pipeline (style seed, design code, self-correction) always runs on Gemini via `llmCreateGemini()` — never the uncensored model.

## Design Language (the web UI)
- **Background**: #0a0a0a (near-black) · **Text**: #c8b88a (warm gold) · **Accents**: #3a3528, #4a4030, #5a5038
- **Font**: Georgia, serif · **Aesthetic**: dark, mystical, ancient library. No bright colors, no modern UI patterns.
- **Scrollbars**: always hidden · **Animations**: smooth and cinematic, never abrupt

## 5-Phase Lifecycle (public/index.html)
All phases driven by CSS classes on `<body>` + JS `enterPhase()`.
1. **DORMANT** — Eye closed, dark, no animations
2. **AWAKENING** — Eye opens, aura fades in, particles start slow, greeting loads. Random "stir" phrase.
3. **ALIVE** — Full animations (breathe, blink, shimmer, tracking, particles). Pupil drifts while thinking.
4. **SEARCHING** — Intensified glow, more particles, expanded aura, golden border traces page perimeter, shuffled progress messages.
5. **SLEEPING** — Eye closes, animations stop, everything fades. AI-generated farewell + outro. "Seek new knowledge..." to restart.

## Ebook Generation Pipeline (server.js → `generateEbook()`)
`totalSteps = chapters.length + 4`. Frontend polls `/api/ebook/:id/status` every 5s for `progress` (0–1) + `step`.
1. **Outline** — LLM returns JSON `{title, subtitle, chapters[]}`. The AI decides the chapter count (NOT hardcoded — 3 to 10+).
2. **Style seed** — a separate high-temperature (1.3) Gemini call invents a unique "design DNA" sentence: 3 hex colors, a *specific unexpected* Google heading font, a body font, decorative style, and overall mood. Drives both interior and cover so they match. Falls back to a default teal aesthetic.
3. **Design code** — Gemini writes the PDFKit layout as JSON (see "AI-Generated PDF Design" below), guided by the style seed.
4. **Design validation + visual QA** (`generateEbook`, up to 3 attempts) — each design is test-rendered on a throwaway PDFKit doc to catch JS errors and `doc.y` overflow; if that passes, a small test PDF (title page + chapter header + sample body) is rendered and sent to **Gemini vision** for a strict PASS/FAIL review. Any issues are fed back to the AI to self-correct `titlePageCode`/`chapterHeaderCode`/`dividerCode`.
5. **Cover** — `generateCover()` returns `{path, needsOverlay}` (see "Cover Generation").
6. **Cover overlay** — if the cover is bare Imagen artwork (`needsOverlay`), the AI is shown the actual image and writes `coverOverlayCode` to place title/subtitle readably over it (contrasting bands/colors based on the artwork).
7. **Chapters** — each chapter generated in its own LLM call (≥800 words, no title in body).
8. **PDF** — `createPDF()` assembles cover → title page → TOC (clickable links) → chapters → page decorations.

## AI-Generated PDF Design (server.js → `createPDF()`)
The PDF interior is NOT hardcoded — the LLM writes the design. The design prompt teaches the model the PDFKit rules, demands ONE intentional design concept (every element must serve it), then asks for JSON containing typography/color choices plus executable JS snippets.
- **Design JSON fields** include: `accent`, `accentLight`, `headingColor`, `bodyColor`, `fontHead`/`fontBody`/`fontItalic`, `bodySize`, `lineGap`, `paragraphSpacing`, `indent`, `textAlign`, `showBorder`/`borderWeight`/`borderColor`, `showDropCap`/`dropCapSize`/`dropCapColor`, `smallCapsFirstWords`, `leadInWordCount`/`leadInFont`/`leadInColor`, `runningHeader`/`runningHeaderPosition`/`runningHeaderAlign`/`runningHeaderStyle`, and JS code strings: `titlePageCode`, `chapterHeaderCode`, `dividerCode`, `chapterEndCode`, `coverOverlayCode`, plus `coverStyle` (cover art direction).
- `runDesignCode(code, extraVars)` runs each snippet via `new Function(...)` with `doc`, `W`, `H`, `outline`, colors, and fonts in scope. Wrapped in try/catch — if AI code throws, a hardcoded fallback layout renders instead.
- **Small-caps lead-in** is an intentional, AI-controlled choice: `leadInFont` (body/head/italic) and `leadInColor` (body/accent/heading) default to a subtle body-font version with light tracking — never the heavy heading font by default.
- `ensureFont(name)` downloads any requested Google Font on demand (fetches the CSS, extracts the TTF URL, caches into `fonts/`). Falls back to Helvetica family if unavailable.
- Every PDF is visually unique because the style seed, colors, fonts, and decorative code all vary per generation.

## Text-on-White Safety — TWO LAYERS
Interior pages are always white, so light text must never slip through. Both layers use perceived luminance `0.299R + 0.587G + 0.114B`:
1. **`ensureDark(hex, maxLum)`** — clamps the named design colors by role: accent ≤0.55, heading ≤0.35, body ≤0.30, border ≤0.60, dropCap ≤0.55. Too-light colors are scaled toward black.
2. **`safeDoc` Proxy** — wraps the PDFKit doc and intercepts EVERY `fillColor()` call, auto-darkening any color with luminance >0.55, so even hardcoded light colors inside AI code can't render invisible. The same Proxy also strips `doc.text(str, x, y)` positional args (prevents cursor corruption / upside-down text).

## PDFKit Safety & Rules — LEARNED THE HARD WAY
- **`runDesignCode` sanitizes AI code** before executing: rewrites `doc.text(str, x, y, ...)` to safe forms, and blocks `doc.transform/rotate/scale/translate/addPage` (they flip/distort text or create ghost pages).
- **NEVER use `doc.text()` inside `switchToPage()`** — creates ghost/empty pages.
- **NEVER use `doc.text(str, x, y)`** for flowing content — destroys the cursor (upside-down/overlapping text). Use `{align}` and let PDFKit position.
- **Borders/dividers**: `doc.rect()`, `doc.moveTo().lineTo()` — pure drawing, wrapped in `doc.save()/doc.restore()`.
- **TOC links**: `doc.goTo()` + `doc.addNamedDestination()` — annotations, not text.
- **Drop caps**: `continued: true` with `baseline` offset — NOT manual positioning.
- **Keep PDF layout SIMPLE** — let PDFKit handle text flow. Don't fight it with rigid positioning.
- **Cover**: full-bleed; Imagen artwork is generated with a 15% safe-margin instruction (edges get cropped), then overscaled to fill A4 with no white gaps.

## Cover Generation (`generateCover()`)
Returns `{path, needsOverlay}`; both paths bill to GCP credits via Vertex AI service-account token.
1. **Nano Banana** (`gemini-2.5-flash-image`) — generates a cover with the title/subtitle baked in → `needsOverlay: false`.
2. **Imagen 3** (`imagen-3.0-generate-002`, 3:4) fallback — pure textless artwork (negative prompt bans text/typography) → `needsOverlay: true`, so the pipeline adds an AI-designed text overlay afterward.

## LLM Provider Switching (server.js)
Clients are constructed at startup from whichever API keys are present; `activeProvider` selects the live one (default `gemini`, runtime-switchable via `/api/mode`).
- `LLM_PROVIDER` — `gemini` (default) | `openai` | `openrouter` | `selfhosted` (selfhosted disabled — no RunPod credits)
- `LLM_MODEL` overrides the model name; otherwise `getModel()` picks a default per provider (`gemini-2.5-flash`, Hermes for OpenRouter, `gpt-5.4-mini` for OpenAI).
- **Vertex AI**: `USE_VERTEX_AI=true` + `VERTEX_PROJECT_ID` + `VERTEX_SERVICE_ACCOUNT_JSON_B64` (or `VERTEX_API_KEY`). Service-account token bills text + images to GCP credits with no free-tier limits.
- **`llmCreate()`** — main chat/chapter caller. Retries on 429 with backoff, then falls back across providers (active → OpenAI → Gemini).
- **`llmCreateGemini()`** — design/outline/style-seed caller. Always Gemini; falls back service-account → OpenAI `gpt-4o-mini` → Gemini API key. Keeps the design pipeline off the uncensored model.
- `tokenLimit()` handles `max_completion_tokens` (OpenAI) vs `max_tokens` (others).

## API Endpoints
- `POST /api/chat` — Main chat (message + sessionId); detects `[TOME_READY]` and kicks off async ebook generation, returns `{reply, tomeGenerating, ebookId}`
- `GET`/`POST /api/greet` — Unique sphinx greeting (POST sends `previous[]` so it never repeats)
- `POST /api/whisper` — AI wisdom on eye click. Body: `previous[]`, `context[]`, `isSearching`. Context-aware and on-theme.
- `GET /api/farewell` — Unique cold farewell
- `GET /api/outro` — Unique "seek again" text (`linkText` + `noteText`)
- `GET`/`POST /api/mode` — Get or set Guardian mode (`{mode: 'censored'|'uncensored'}`); returns active `provider` + `model`
- `GET /api/ebook/:id/status` — Poll ebook generation (`status`, `title`, `progress` 0–1, `step`, `error`)
- `GET /api/ebook/:id/download` — Download PDF
- `GET /api/status` — LLM connection check

## Juice & Interactivity (frontend)
- **Eye click** — pupil dilates, aura flashes, AI whispers real wisdom (via `/api/whisper`); context-aware and interconnected.
- **Typing effect** — Guardian messages type letter by letter (adaptive speed)
- **Sound** — Web Audio API: ambient drone, tones on eye open/close, click sounds, chord on delivery. Drone pitch shifts on mode toggle. Mute saved to localStorage.
- **Screen shake** — on tome search start, delivery, and mode toggle
- **Particle burst** — particles explode from eye on delivery
- **Border loader** — golden line traces page border during generation, synced to real progress
- **Tomes counter** — localStorage tracks tomes collected, shown bottom-right

## Settings Panel & Monetization (gear icon, top-right)
- **Sound** — on/off toggle + volume slider
- **Guardian Mode** — Censored/Uncensored toggle (calls `/api/mode`)
- **Progress** — tomes collected count + reset
- **Appearance** — Dark/Light mode toggle ("The Sunlit Hall" — `body.light-mode`), saved to localStorage
- **Support the Library** — "Become a Member — $49" + custom-amount donation, both via LemonSqueezy checkout (`LS_DONATE_URL` with `checkout[custom_price]` in cents)
- **Coming soon** (placeholders): Google/Microsoft sign-in, browse-all-tomes library

## UX Principles
- **SIMPLE. NOT OVERCOMPLICATED.** — #1 rule. Mohamed hates overengineering. If a feature gets complex and buggy, strip it back.
- **One page, one flow, no navigation**
- **Everything smooth** — phase transitions must be cinematic, never abrupt
- **Mobile friendly** — responsive eye, send button, 16px font (no iOS zoom), safe area insets
- **Every text should vary** — greetings, stir phrases, progress messages, farewells, outros, whispers are all randomized or AI-generated
- **Every interaction must be valuable** — whispers give real wisdom, not generic mystery
- **No visible scrollbars** — hidden everywhere
- **The Guardian never breaks character**
- **Don't fight the tools** — if PDFKit/CSS resist a design, simplify the design; don't hack around limitations with brittle workarounds.
- **Design must be intentional** — variety between books is great, but within one book every choice serves a single coherent concept; never random or clashing.

## Repo Layout
- `server.js` — entire backend (Express app, LLM routing, ebook + cover + PDF pipeline, design validation/QA)
- `public/index.html` — entire frontend (HTML/CSS/JS in one file)
- `public/favicon.jpg`
- `fonts/*.ttf` — bundled fonts (more downloaded on demand into this dir)
- `.claude/agents/` — project subagents: `code-guardian` (build/fix/review), `guardian-designer` (UI/UX), `tome-writer` (ebook + prompts), `vibe-check` (end-to-end QA)
- `.env` (gitignored) holds API keys; `ebooks/` and `node_modules/` are gitignored

## Workflow
- Run locally with `npm start` (needs `.env` with at least one provider key)
- **After EVERY feature or fix, commit and push directly to `main`** — no feature branches or PRs needed (Mohamed's standing instruction). Don't wait to batch changes.
- Railway auto-deploys from GitHub `main`

## Git Remote
- Origin: https://github.com/MAZMS/greatlibraryai.git
- Branch: main
