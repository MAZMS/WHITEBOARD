# Great Library AI

## What This Is
An AI-powered ebook generator disguised as a mystical library experience. Users ("Seekers") visit greatlibrary.ai, converse with the Guardian (an all-knowing sphinx entity), and receive a custom-generated DOCX ebook on their chosen topic. The experience spans multiple pages: a waitlist landing page, the main library chat, a browsable tome library, an admin dashboard, an investor pitch page, and legal pages.

## Core Flow
1. **Awakening** -- Eye opens from darkness over ~6s, greeting appears
2. **Conversation** -- Guardian asks sphinx-like questions (2-3 exchanges max) to understand what the seeker wants
3. **Searching** -- Eye intensifies, border traces the page, progress messages cycle while ebook generates in background
4. **Delivery** -- Download link appears (.docx), Guardian gives a farewell
5. **Sleep** -- Eye closes, everything fades, "Seek new knowledge..." link to restart

## Tech Stack
- **Frontend**: `public/index.html` (~4000 lines) -- main library, pure HTML/CSS/JS, no frameworks. Additional pages: `waitlist.html` (~2000 lines), `tomes.html` (~840 lines), `tome.html` (~1300 lines), `legal.html` (~630 lines), `admin.html` + `admin-app.js` + `admin-style.css` (~620 lines total)
- **Backend**: `server.js` (~3700 lines) -- Express + OpenAI SDK + `docx` package + auth + tome library + admin + investor APIs
- **Database**: `db.js` (~1360 lines) -- PostgreSQL via `pg` (node-postgres). 14 tables, auto-migrating schema. Falls back to JSON files when `DATABASE_URL` not set.
- **LLM (text)**: Gemini 2.5 Flash by default (`LLM_PROVIDER=gemini`), with OpenAI, OpenRouter, and self-hosted as alternates -- all called through the OpenAI SDK
- **Image (covers)**: Gemini 2.5 Flash Image ("Nano Banana") -> Imagen 3 fallback, both via Vertex AI
- **Auth**: Google OAuth (GSI), Microsoft OAuth (MSAL), email+password (bcryptjs). JWT sessions via `jsonwebtoken`. `google-auth-library` for Vertex AI service-account tokens.
- **Fonts**: On-demand Google Fonts download to `fonts/` -- `ensureFont()` fetches TTF from Google Fonts API
- **Deps**: `express`, `openai`, `docx`, `google-auth-library`, `dotenv`, `pg`, `jsonwebtoken`, `bcryptjs`, `pdfkit`, `pdf-to-img`
- **Hosting**: Railway (port 8080), custom domain greatlibrary.ai
- **Ebooks**: Generated as `.docx` to `/tmp/ebooks` on Railway, else `./ebooks`. When DB is connected, DOCX binary + cover stored as BYTEA for persistence across redeploys.

## Guardian Persona -- THE MOST IMPORTANT THING
The Guardian is a **sphinx**, not a chatbot. It follows **Law 4: Always Say Less Than Necessary**.

- **Cryptic, powerful, few words.** One sentence better than two. A fragment better than a sentence.
- **Takes immense, quiet pride** in possessing infinite knowledge of the universe.
- **Does not serve** the seeker. It **permits** access. There is a difference.
- **Sphinx-like questions** -- never lists options like a menu. Asks piercing, short questions.
- **No emojis. No warmth. Regal indifference.** The seeker should feel they are in the presence of something vast and ancient.
- Examples: "Ah. That door.", "Many have sought this. Few were ready.", "The shallow pool... or the abyss beneath it?"
- Max 2 sentences per response. Fewer is better.
- By exchange 3, must trigger ebook generation ([TOME_READY] marker).

## Two Guardian Modes
Selected by which provider is active (toggled via `/api/mode`):
- **Censored** (default) -- `SYSTEM_PROMPT`, runs on Gemini ("The Main Hall"). Standard sphinx.
- **Uncensored** -- `SYSTEM_PROMPT_UNCENSORED`, runs on OpenRouter (Hermes, "The Forbidden Wing"). No content restrictions, no disclaimers. `isUncensoredProvider()` returns true for `openrouter`/`selfhosted` and switches both the chat prompt AND the ebook prompts (adds an uncensored note). The frontend shifts atmosphere (red eye glow, lower drone pitch, screen shake) when toggled.
- **Note**: chat + chapter text honor the active (possibly uncensored) provider, but the *design* pipeline (style config) always runs on Gemini via `llmCreateGemini()` -- never the uncensored model.

## Design Language (the web UI)
- **Background**: #0a0a0a (near-black) . **Text**: #c8b88a (warm gold) . **Accents**: #3a3528, #4a4030, #5a5038
- **Font**: Georgia, serif . **Aesthetic**: dark, mystical, ancient library. No bright colors, no modern UI patterns.
- **Scrollbars**: always hidden . **Animations**: smooth and cinematic, never abrupt

## 5-Phase Lifecycle (public/index.html)
All phases driven by CSS classes on `<body>` + JS `enterPhase()`.
1. **DORMANT** -- Eye closed, dark, no animations
2. **AWAKENING** -- Eye opens, aura fades in, particles start slow, greeting loads. Random "stir" phrase.
3. **ALIVE** -- Full animations (breathe, blink, shimmer, tracking, particles). Pupil drifts while thinking.
4. **SEARCHING** -- Intensified glow, more particles, expanded aura, golden border traces page perimeter, shuffled progress messages.
5. **SLEEPING** -- Eye closes, animations stop, everything fades. AI-generated farewell + outro. "Seek new knowledge..." to restart.

## Database Layer (db.js)
PostgreSQL via `pg`. Connection pooled (max 10), SSL in production. All IPs hashed with SHA-256 before storage. All queries parameterized.

**14 tables** (auto-created on startup):
- `waitlist` -- email signups with UTM, device, survey answers
- `accounts` -- user accounts (email, OAuth providers, password hash, ebook history, membership)
- `ebook_jobs` -- generation jobs (status, progress, DOCX binary as BYTEA, cover binary)
- `conversations` -- chat message history (persists across restarts)
- `metrics_kv` -- key-value store for cumulative metrics
- `visitors` -- hashed-IP visitor log with geo data
- `rate_limits` -- persistent rate limiting (survives restarts)
- `budget_alerts` -- LLM provider budget alert log
- `tomes` -- published tomes (title, chapters JSONB, cover BYTEA, engagement counts)
- `tome_likes` -- like/dislike records (unique per user+tome+type)
- `tome_saves` -- bookmark records
- `tome_comments` -- threaded comments with likes
- `tome_views` -- view records for unique counting (deduped per IP per hour)
- `tome_reports` -- content reports

**Fallback pattern**: Every server.js function checks `useDB()` first. If PostgreSQL is unavailable, falls back to JSON files (`waitlist.json`, `accounts.json`, `jobs.json`, `tomes.json`, `metrics.json`). The app works fully without a database.

## Ebook Generation Pipeline (server.js -> `generateEbook()`)
`totalSteps = chapters.length + 4`. Frontend polls `/api/ebook/:id/status` every 5s for `progress` (0-1) + `step`.
1. **Outline** -- LLM returns JSON `{title, subtitle, chapters[]}`. The AI decides the chapter count (NOT hardcoded -- 3 to 10+).
2. **Design config** -- Gemini generates a simple style JSON: `accent`, `headingColor`, `bodyColor`, `fontHead`, `fontBody`, `bodySize`, `lineSpacing`, `indent`, `textAlign`, `divider`, `endMark`, `coverStyle`. No executable code -- just style parameters. Colors are clamped via `ensureDark()`.
3. **Font download** -- `ensureFont()` downloads any requested Google Fonts to `fonts/` (fetches CSS, extracts TTF URL, caches).
4. **Cover** -- `generateCover()` returns `{path, needsOverlay}` (see "Cover Generation").
5. **Chapters** -- each chapter generated in its own LLM call (>=800 words, no title in body).
6. **DOCX** -- `createDocx()` assembles cover (full-bleed floating image) -> title page -> TOC (clickable links via Bookmark + InternalHyperlink) -> chapters with styled headings and body text.
7. **Publish** -- auto-publishes to Tome Library (DB + JSON). Cover saved permanently to `ebooks/covers/`.

## DOCX Generation (server.js -> `createDocx()`)
Uses the `docx` npm package -- declarative, no executable code, no positioning bugs.
- **3 sections**: Cover page (zero margins, floating image), Title page (centered title/subtitle/greatlibrary.ai), Content (TOC + all chapters with headers/footers/page numbers).
- **Cover image**: `ImageRun` with `floating` property, anchored to page at (0,0). Image type detected from magic bytes (PNG vs JPEG).
- **TOC**: Each entry is an `InternalHyperlink` pointing to a `Bookmark` at the chapter heading. Clickable in Word.
- **Chapters**: Page break -> chapter number -> title -> divider -> body paragraphs -> end mark. All styled with the AI-generated design config (fonts, colors, spacing).
- **Headers/footers**: Running header with book title (italicized), footer with page number. Only on content section.
- `ensureDark(hex, maxLum)` -- clamps colors so text is always readable on white. Uses perceived luminance `0.299R + 0.587G + 0.114B`.

## Cover Generation (`generateCover()`)
Returns `{path, needsOverlay}`; both paths bill to GCP credits via Vertex AI service-account token. Cover prompts explicitly ban borders/frames -- artwork must fill edge to edge.
1. **Nano Banana** (`gemini-2.5-flash-image`) -- generates a cover with the title/subtitle baked in -> `needsOverlay: false`.
2. **Imagen 3** (`imagen-3.0-generate-002`, 3:4) fallback -- pure textless artwork (negative prompt bans text/typography/borders) -> `needsOverlay: true`.

## LLM Provider Switching (server.js)
Clients are constructed at startup from whichever API keys are present; `activeProvider` selects the live one (default `gemini`, runtime-switchable via `/api/mode`).
- `LLM_PROVIDER` -- `gemini` (default) | `openai` | `openrouter` | `selfhosted` (selfhosted disabled -- no RunPod credits)
- `LLM_MODEL` overrides the model name; otherwise `getModel()` picks a default per provider (`gemini-2.5-flash`, Hermes for OpenRouter, `gpt-5.4-mini` for OpenAI).
- **Vertex AI**: `USE_VERTEX_AI=true` + `VERTEX_PROJECT_ID` + `VERTEX_SERVICE_ACCOUNT_JSON_B64` (or `VERTEX_API_KEY`). Service-account token bills text + images to GCP credits.
- **`llmCreate()`** -- main chat/chapter caller. Retries on 429 with backoff, then falls back across providers (active -> OpenAI -> Gemini).
- **`llmCreateGemini()`** -- design config caller. Always Gemini; falls back service-account -> OpenAI `gpt-4o-mini` -> Gemini API key.
- `tokenLimit()` handles `max_completion_tokens` (OpenAI) vs `max_tokens` (others).
- **LLM usage tracking**: every call logs provider, model, token counts, latency to `metrics.llmUsage`. OpenRouter spend calculated from token pricing.

## API Endpoints

### Pages (server.js routes)
- `GET /` -- authenticated users get library (`index.html`), others get waitlist
- `GET /waitlist` -- waitlist landing page
- `GET /library` -- main library (index.html)
- `GET /admin` -- admin dashboard (requires admin auth)
- `GET /tomes` -- tome library browse page
- `GET /tome/:id` -- tome detail page
- `GET /tome/:id/read` -- tome reading view
- `GET /invest` -- investor pitch page
- `GET /terms`, `/privacy`, `/cookies`, `/acceptable-use`, `/dmca`, `/refund`, `/disclaimer` -- legal pages

### Chat & Guardian
- `POST /api/chat` -- main chat; detects `[TOME_READY]`, kicks off ebook generation
- `GET`/`POST /api/greet` -- unique sphinx greeting (POST sends `previous[]`)
- `POST /api/whisper` -- AI wisdom on eye click (context-aware)
- `GET /api/farewell` -- unique cold farewell
- `GET /api/outro` -- unique "seek again" text
- `GET`/`POST /api/mode` -- get/set Guardian mode (censored/uncensored)
- `GET /api/status` -- LLM connection check + database status

### Ebooks
- `GET /api/ebook/:id/status` -- poll generation progress
- `GET /api/ebook/:id/download` -- download DOCX (filesystem -> DB fallback)

### Auth
- `POST /api/auth/google` -- Google One Tap sign-in
- `POST /api/auth/google/token` -- Google OAuth access token sign-in (fallback)
- `POST /api/auth/microsoft` -- MSAL sign-in
- `POST /api/auth/email/signup` -- email+password registration
- `POST /api/auth/email/signin` -- email+password login
- `POST /api/auth/forgot-password` -- generate reset token (logged to console, no email service yet)
- `POST /api/auth/reset-password` -- validate token and set new password
- `POST /api/auth/check-email` -- check if email has an account (for waitlist flow)
- `POST /api/auth/signout` -- clear session cookie
- `GET /api/auth/me` -- current user from session
- `GET /api/auth/access` -- check if user has library access (privileged check)
- `GET /api/auth/ebooks` -- user's ebook history
- `GET /api/auth/config` -- client IDs for Google/Microsoft OAuth

### Waitlist
- `GET /api/waitlist/count` -- current waitlist size
- `POST /api/waitlist/signup` -- email capture (rate-limited, validated, deduped)
- `POST /api/waitlist/survey` -- post-signup survey answers

### Tome Library
- `GET /api/tomes` -- browse tomes (filters, sort, pagination, topic tags)
- `GET /api/tomes/trending` -- top 10 trending tomes
- `GET /api/tomes/search?q=` -- search by title/subtitle/author/tags
- `GET /api/tomes/:id` -- full tome details (increments view count)
- `GET /api/tomes/:id/chapters` -- chapter content for online reading
- `GET /api/tomes/:id/cover` -- serve cover image (filesystem -> DB fallback)
- `GET /api/tomes/:id/download` -- download DOCX (tracks download count)
- `GET /api/tomes/:id/user-state` -- check if user has liked/saved/disliked
- `GET /api/tomes/:id/comments` -- threaded comments
- `POST /api/tomes/:id/like` -- toggle like (works for anon via IP hash)
- `POST /api/tomes/:id/dislike` -- toggle dislike
- `POST /api/tomes/:id/save` -- toggle bookmark (requires auth)
- `POST /api/tomes/:id/report` -- report a tome
- `POST /api/tomes/:id/comments` -- add comment (requires auth)
- `POST /api/tomes/:id/comments/:commentId/like` -- like a comment
- `GET /api/my-tomes` -- current user's created tomes
- `GET /api/my-tomes/saved` -- bookmarked tomes

### Admin (all require admin auth)
- `GET /api/admin/metrics` -- full metrics dump (system, providers, visitors, errors, ebooks, LLM usage, budget)
- `GET /api/admin/waitlist` -- full waitlist data + survey stats + UTM campaigns + signup trends
- `GET /api/admin/ebooks` -- ebook generation history + success rate + avg duration
- `GET /api/admin/accounts` -- all user accounts
- `GET /api/admin/usage` -- LLM usage per provider (daily + all-time + budget alerts)
- `GET /api/admin/visitors` -- recent visitors (DB or in-memory fallback)
- `GET /api/admin/retention` -- new vs returning visitor stats
- `GET /api/admin/geo` -- geographic breakdown (countries + cities)
- `GET /api/admin/analytics` -- full analytics (heatmap, browsers, devices, traffic sources, funnel, daily trends)
- `GET /api/admin/periods` -- time-period comparisons (today/week/month/year/all-time with previous-period deltas)
- `POST /api/admin/chat` -- Guardian advisor chat (LLM-powered metrics analysis)

### Investor
- `GET /api/invest/metrics` -- public metrics for pitch page (waitlist count, tomes, countries, growth rate, willingness to pay)
- `POST /api/invest/chat` -- Guardian investor chat (LLM with pitch context + live metrics)
- `POST /api/invest/interest` -- save investor interest (name, email, investment range, message)

### Tracking
- `POST /api/track/funnel` -- micro-conversion events (pageView, emailFocus, emailSubmit, surveyStart, surveyComplete)

## Tome Library
Every generated ebook auto-publishes to the Tome Library. Existing ebooks migrate on startup (from `jobs.json` + orphaned `.docx` files). Topic tags are keyword-matched from title/subtitle (19 categories). Covers served from filesystem with DB fallback.

Pages:
- `tomes.html` -- browse page with grid of tome cards, topic filters, sort options, search, pagination
- `tome.html` -- detail page with cover, metadata, chapter list, online reading view, engagement (like/dislike/save/share/report/comments), download

## Admin Dashboard
Split into 3 files: `admin.html` (shell), `admin-app.js` (logic, ~430 lines), `admin-style.css` (styles, ~155 lines). Requires admin auth. Shows metrics, waitlist data, ebook stats, accounts, LLM usage, visitors, analytics, period comparisons, and a Guardian advisor chat.

## Juice & Interactivity (frontend)
- **Eye click** -- pupil dilates, aura flashes, AI whispers real wisdom (via `/api/whisper`); context-aware and interconnected.
- **Typing effect** -- Guardian messages type letter by letter (adaptive speed)
- **Sound** -- Web Audio API: ambient drone, tones on eye open/close, click sounds, chord on delivery. Drone pitch shifts on mode toggle. Mute saved to localStorage.
- **Screen shake** -- on tome search start, delivery, and mode toggle
- **Particle burst** -- particles explode from eye on delivery
- **Border loader** -- golden line traces page border during generation, synced to real progress
- **Tomes counter** -- localStorage tracks tomes collected, shown bottom-right

## Settings Panel (gear icon, top-right)
Title: "Chamber of Secrets". Order: Account -> Appearance -> Mode -> Sound -> Progress.
- **Account** -- Google/Microsoft/email sign-in, signed-in state with avatar/name, sign-out, ebook history
- **Appearance** -- Dark/Light mode toggle ("The Sunlit Hall" -- `body.light-mode`), saved to localStorage
- **Guardian Mode** -- Censored/Uncensored toggle (calls `/api/mode`)
- **Sound** -- on/off toggle + volume slider
- **Progress** -- tomes collected count + reset

## Auth & Sessions
- JWT auth cookie (`gl_token`), httpOnly, 30-day expiry, path `/`
- JWT_SECRET must be stable across deploys -- set as Railway env var or derived from stable env vars
- Google sign-in uses `renderButton()` (not `prompt()` which fails silently)
- Microsoft sign-in uses MSAL popup with `/consumers` authority
- Email accounts: signup with password (bcrypt, min 8 chars), forgot password flow (reset token logged to console -- no email service yet)
- `optionalAuth()` middleware: reads cookie, attaches `req.user` if valid, never blocks
- `requireAdmin()` middleware: verifies admin email
- Account auto-links to waitlist entry by matching email

## UX Principles
- **SIMPLE. NOT OVERCOMPLICATED.** -- #1 rule. If a feature gets complex and buggy, strip it back.
- **Everything smooth** -- phase transitions must be cinematic, never abrupt
- **Mobile friendly** -- responsive eye, send button, 16px font (no iOS zoom), safe area insets
- **Every text should vary** -- greetings, stir phrases, progress messages, farewells, outros, whispers are all randomized or AI-generated
- **Every interaction must be valuable** -- whispers give real wisdom, not generic mystery
- **No visible scrollbars** -- hidden everywhere
- **The Guardian never breaks character**
- **Don't fight the tools** -- if CSS or the `docx` library resist a design, simplify the design

## Repo Layout
- `server.js` (~3700 lines) -- entire backend: Express app, LLM routing, ebook pipeline, auth, tome library, admin, investor APIs, metrics tracking
- `db.js` (~1360 lines) -- PostgreSQL data layer (connection, schema, 14 tables, all CRUD). Falls back to JSON when `DATABASE_URL` not set.
- `public/index.html` (~4000 lines) -- main library frontend (HTML/CSS/JS in one file)
- `public/waitlist.html` (~2000 lines) -- waitlist landing page with survey wizard, sound, OAuth, dark/light mode
- `public/tomes.html` (~840 lines) -- tome library browse page
- `public/tome.html` (~1300 lines) -- tome detail + reading page
- `public/legal.html` (~630 lines) -- legal pages template (Terms, Privacy, Cookies, etc.)
- `public/admin.html` (~30 lines) -- admin dashboard shell
- `public/admin-app.js` (~430 lines) -- admin dashboard logic
- `public/admin-style.css` (~155 lines) -- admin dashboard styles
- `public/favicon.jpg`
- `public/.well-known/microsoft-identity-association.json` -- Microsoft Entra domain verification
- `fonts/*.ttf` -- bundled fonts (more downloaded on demand)
- `.claude/agents/` -- 15 project subagents (see below)
- `.env` (gitignored) holds API keys; `ebooks/` and `node_modules/` are gitignored

## Agents
- `code-guardian` -- build, fix, review code across the codebase
- `guardian-designer` -- UI/UX design for all pages
- `tome-writer` -- ebook generation quality (prompts, DOCX formatting, pipeline)
- `vibe-check` -- end-to-end QA testing
- `waitlist-architect` -- waitlist/landing page, signup flow, conversion optimization
- `admin-dashboard` -- admin metrics, analytics, operational visibility
- `legal-scribe` -- legal pages (Terms, Privacy, Cookies, DMCA, etc.)
- `account-keeper` -- auth system (Google/Microsoft/email OAuth, sessions, accounts)
- `data-keeper` -- database layer, PostgreSQL, migrations, data integrity
- `tome-library` -- browsable tome library (browse, read, engage, social features)
- `investor-pitch` -- investor pitch page, live metrics, Guardian investor chat
- `device-alchemist` -- cross-device responsive testing and fixes
- `codex-keeper` -- meta-agent that audits and updates all agents + docs to match current codebase

## Privileged Accounts
These emails have admin/privileged access everywhere (library gate, admin dashboard, any gated feature):
- `greatlibraryai@gmail.com`
- Any email ending in `@greatlibrary.ai` (e.g., `z@greatlibrary.ai`)
- Server-side check: `email === 'greatlibraryai@gmail.com' || email.endsWith('@greatlibrary.ai')`
- ALWAYS enforce server-side, never client-only

## Provider Budgets (track and alert)
- **OpenRouter**: $8 credits, model `nousresearch/hermes-4-405b`, $1/1M input + $3/1M output. Alert at < $2.
- **OpenAI**: Free tier (shared data), 250K tokens/day premium, 2.5M tokens/day mini/nano. Alert at > 80% daily.
- **Gemini**: GCP $300 credits via service account. Alert at < $50 remaining.
- Alert emails go to `greatlibraryai@gmail.com` and `z@greatlibrary.ai`
- Budget tracking is automated in `trackLlmUsage()` + `checkBudgetAlerts()`. OpenRouter spend calculated from token pricing. Alerts stored in `metrics.budgetAlerts`.

## Launch Date
- **Library opens to the public: June 1, 2026 00:00:00 UTC**
- Until then, only privileged accounts can access the library
- Non-privileged users see a countdown timer on the library page

## Microsoft Auth (Entra ID)
- Client ID: `3fe2e1f9-4f6d-4f22-98cc-b536bb9ff0bc`
- Platform: SPA (not Web) -- MSAL browser popup, no client secret
- Authority: `https://login.microsoftonline.com/consumers`
- SPA Redirect URIs: `https://greatlibrary.ai`, `http://localhost:8080`
- Railway env: only `MICROSOFT_CLIENT_ID` needed (no secret, no redirect URI env var)

## Environment Variables
- `DATABASE_URL` -- PostgreSQL connection string (Railway provides automatically)
- `IP_HASH_SALT` -- salt for hashing visitor IPs before storage
- `JWT_SECRET` -- stable secret for JWT signing (derived from stable env vars if not set)
- `LLM_PROVIDER` -- active LLM provider (`gemini`/`openai`/`openrouter`)
- `LLM_MODEL` -- override model name
- `USE_VERTEX_AI` -- `true` to use Vertex AI for Gemini
- `VERTEX_PROJECT_ID`, `VERTEX_SERVICE_ACCOUNT_JSON_B64`, `VERTEX_API_KEY` -- Vertex AI config
- `GEMINI_API_KEY` -- Gemini API key (fallback if no service account)
- `OPENAI_API_KEY` -- OpenAI API key
- `OPENROUTER_API_KEY` -- OpenRouter API key
- `GOOGLE_CLIENT_ID` -- Google OAuth client ID
- `MICROSOFT_CLIENT_ID` -- Microsoft Entra client ID

## Mohamed's Preferences (don't make him repeat these)
- **Screenshots ARE the spec** -- when he shares a screenshot, understand the issue from the visual
- **Delegate to agents** -- launch in background, parallel when possible, give full context
- **Wizard > wall of options** -- multi-step forms should show one question at a time (Back/Next)
- **No skip buttons** -- survey questions are mandatory, shake + validate on empty answers
- **Always include "Other"** -- any multiple-choice must have an Other option with text input
- **No clutter in locked states** -- show normal UI but disabled, not overlay text/gates
- **Rewards for completion** -- gate features behind completing flows (e.g., survey -> library access)
- **No premature monetization** -- don't show $49 membership or payment UI pre-launch, it's a turn-off
- **Simple > fancy** -- if something gets complex and buggy, strip it back
- **Don't fight the tools** -- if a library resists a design, simplify the design
- **Settings panel** -- title is "Chamber of Secrets", order: Account -> Appearance -> Mode -> Sound -> Progress

## Workflow
- Run locally with `npm start` (needs `.env` with at least one provider key)
- **After EVERY feature or fix, commit and push directly to `main`** -- no feature branches or PRs needed (Mohamed's standing instruction). Don't wait to batch changes.
- Railway auto-deploys from GitHub `main`

## Git Remote
- Origin: https://github.com/MAZMS/greatlibraryai.git
- Branch: main
