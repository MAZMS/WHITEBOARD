# Whiteboard Agent System — Rules for Claude Code

Real-time whiteboard + AI agent platform at **greatlibrary.ai**.
These rules govern how YOU work and how agents on the board work.

## The Operator

Maz (MAZMS). Solo founder. Works fast, thinks visually, delegates everything.

- Screenshots = instructions. Read them, understand them, act.
- "Do it" means DO IT. No clarification needed.
- Claude Max sessions — maximize output. Never idle.
- After every meaningful change: **commit + push to main**.
- Railway auto-deploys from main. Check `railway logs` if it crashes.

## How to Work

1. **Read before writing.** Never edit blind. Understand the file first.
2. **Launch agents in parallel.** Independent tasks run simultaneously.
3. **Background agents get full context.** They haven't seen the conversation.
4. **Ship fast, fix fast.** Push to main, check Railway, fix if broken.
5. **Pick the next task automatically.** Don't wait for instructions.
6. **Simple > clever.** If it works and it's readable, it's done.
7. **No feature creep.** Build what was asked. Nothing more.

## Architecture

```
greatlibraryai/
├── server.js          # Express server — routes, OpenAI proxy, token tracking
├── agents/
│   └── index.js       # 10 agent definitions (system prompts, icons, tiers)
├── public/
│   ├── index.html     # Whiteboard — canvas, contact cards, chat panel, command bar
│   └── admin.html     # Admin — token tracker, model picker, request history
├── package.json       # express + openai — no build step
├── .env.example       # OPENAI_API_KEY, ADMIN_PASSWORD, PORT
└── CLAUDE.md          # This file
```

**Key routes in server.js:**
- `POST /api/agent` — chat with agent (single response)
- `POST /api/agent/stream` — streaming chat with SSE
- `POST /api/agent/pick` — goal-based agent router (uses gpt-4o-mini to match goal to best agent)
- `GET /api/agents` — list all agent contact cards
- `GET /api/admin/usage` — token usage stats (premium + mini breakdown)
- `POST /api/admin/settings` — update default model
- `POST /api/admin/reset` — reset daily usage counters
- `GET /health` — health check

## Invariants

1. **No build step.** Plain HTML + CSS + vanilla JS in `public/`. No React, no bundler, no TypeScript.
2. **Pure black and white + light theme.** Dark: #000 bg, #fff text, #333 borders. Light theme via `[data-theme="light"]`.
3. **Secrets in `process.env` only.** Never commit, log, or echo API keys.
4. **Token tracking is mandatory.** Every OpenAI call MUST log to the in-memory usage tracker.
5. **Daily limits are sacred:**
   - Premium models (gpt-5.4, gpt-5, gpt-4.1, o1, o3): **250,000 tokens/day**
   - Mini models (gpt-5.4-mini, gpt-4o-mini, o4-mini): **2,500,000 tokens/day**
6. **Admin at `/admin`** — always accessible, always shows real-time usage.
7. **New env var → add to `.env.example`** in the same commit.

## Security & Hardening

- **Security headers:** `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin` on every response.
- **Body size limit:** `express.json({ limit: '50kb' })` — prevents payload abuse.
- **Graceful shutdown:** `SIGTERM` handler for clean Railway restarts.
- **Safe error messages:** `safeErrorMessage()` never leaks stack traces or internal details.
- **Rate limit handling:** 429 responses surface a friendly "slow down" toast instead of raw errors.
- **Error toasts + retry:** Failed API calls show a dismissible toast with a retry button.
- **Client disconnect handling:** SSE streams abort upstream when client disconnects.

## Design Rules — Dopamine Philosophy

- **Micro-animations everywhere.** Cubic-bezier transitions, entrance bounce, hover lift, typing dots. Every interaction rewards the user.
- No visible scrollbars. `scrollbar-width: none` globally.
- **Mobile responsive.** 640px breakpoint. Touch targets >= 44px. No horizontal overflow.
- **Accessibility.** `focus-visible` outlines on interactive elements. 44px minimum touch targets throughout.
- Monospace font stack: `'SF Mono', 'Fira Code', 'Consolas', monospace`.
- Every interaction should feel instant. Optimistic UI.
- **Full light mode parity.** Both `index.html` and `admin.html` are polished in light and dark themes via `[data-theme="light"]`.
- Conversational tone: agents talk like smart friends texting, never like customer service bots.

## Agent System

**Goal-based summoning:** User types a goal in the frosted-glass command bar (`backdrop-filter: blur`). The router (`/api/agent/pick`) uses gpt-4o-mini to select the best agent and returns a casual greeting. Tokens from the pick call count against the mini tier budget.

**Two-stage UX:**
1. **Contact cards on canvas** — draggable agent icons showing name, icon, description, and tier badge. Click or tap to open chat.
2. **Slide-in chat panel** — full-height messenger panel slides in from the right with streaming SSE responses, "typing..." header status, message timestamps, and conversation history.

**Conversation persistence:** Chat history is saved to `localStorage` per agent and restored on page load. A clear-chat button in the panel header wipes the stored conversation.

**Context window:** The server trims to the **last 20 messages** before sending to OpenAI, keeping context useful without blowing token budgets.

**10 agents** (defined in `agents/index.js`):
- Premium tier: architect, coder, designer, thinker, debugger, reviewer
- Mini tier: writer, researcher, planner, ops

All agents share a `HUMAN_VOICE` suffix enforcing casual texting style, no markdown, short responses, and natural follow-up questions.

When adding agents: define in `agents/index.js` — they auto-register in the API and whiteboard.

## Admin Dashboard (`/admin`)

- **Token usage gauges** — real-time premium + mini usage with percentage bars.
- **Model selector** — dropdown with grouped models (premium vs mini). Changes the default model for all agent calls.
- **Request history** — last 100 requests with alternating row stripes, right-aligned numbers, and pill-style tier tags.
- **Reset button** — double-click to confirm, clears daily counters without restarting the server.
- Models are served from the server's `PREMIUM_MODELS` and `MINI_MODELS` arrays so admin always matches reality.

## Keyboard Shortcuts

- **Ctrl+Shift+C** — clear the whiteboard (reset all cards to default positions).

## UX Polish

- **Scroll-to-bottom pill** — appears when scrolled up in chat; click to jump to latest message.
- **Placeholder rotation** — input cycles through phrases ("Say something...", "What's on your mind?", etc.).

## Claude Code Agent Lanes

4 parallel Claude Code agents for recursive improvement cycles:

| Agent | Owns | Focus |
|-------|------|-------|
| **Designer** | `public/index.html` | UI, animations, responsiveness, accessibility |
| **Coder** | `server.js` + `agents/index.js` | API routes, streaming, token tracking, error handling |
| **Ops** | `CLAUDE.md` + Railway | Docs, deployment, hardening, monitoring |
| **Tester** | All files (read-only) | Manual QA, edge cases, regression checks |

**Recursive improvement cycle:** Designer and Coder run in parallel on their files. Ops updates docs. Tester reviews everything last. Each cycle ships a commit. Never add features during polish cycles — only perfect what exists.

## Recursive Learning

This file evolves. When Mohamed gives feedback:
1. How Claude should work → update this CLAUDE.md
2. Design/UX → update the Design Rules section
3. Product → update Architecture or Agent System section
4. Personal preference → save to memory system

## Railway Deployment

- Domain: **greatlibrary.ai**
- Service: `greatlibraryai` on Railway (US East)
- Auto-deploys on push to `main`
- Commands: `railway status`, `railway logs`, `railway variables`
- Build: `npm install` → `npm start` (node server.js)
- After pushing, always verify with `railway status` + `railway logs`

## When in Doubt

- Ship it. Fix later.
- Simple beats clever.
- Commit and push. Always.
- Check Railway. Always.
