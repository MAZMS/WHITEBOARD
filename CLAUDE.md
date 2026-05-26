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
│   ├── index.html     # Whiteboard — canvas, contact cards, chat panels, command bar
│   └── admin.html     # Admin — token tracker, model picker, request history
├── package.json       # express + openai — no build step
├── .env.example       # OPENAI_API_KEY, ADMIN_PASSWORD, PORT
└── CLAUDE.md          # This file
```

**Key routes in server.js:**
- `POST /api/agent` — chat with agent (single response)
- `POST /api/agent/stream` — streaming chat with SSE
- `POST /api/agent/pick` — goal-based agent router (uses gpt-4o-mini)
- `GET /api/agents` — list all agent contact cards
- `GET /api/admin/usage` — token usage stats
- `POST /api/admin/settings` — update default model
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

## Design Rules — Dopamine Philosophy

- **Micro-animations everywhere.** Cubic-bezier transitions, entrance bounce, hover lift, typing dots. Every interaction rewards the user.
- No visible scrollbars. `scrollbar-width: none` globally.
- Mobile-friendly. Touch targets >= 44px. No horizontal overflow.
- Monospace font stack: `'SF Mono', 'Fira Code', 'Consolas', monospace`.
- Every interaction should feel instant. Optimistic UI.
- Conversational tone: agents talk like smart friends texting, never like customer service bots.

## Agent System

**Goal-based summoning:** User types a goal in the command bar. The router (`/api/agent/pick`) selects the best agent and opens it with a casual greeting.

**Two-stage UX:**
1. **Contact cards** — draggable agent icons on the canvas, showing name + description.
2. **Chat panel** — slides in from the right as a full-height messenger-style panel with streaming responses.

**10 agents** (defined in `agents/index.js`):
- Premium tier: architect, coder, designer, thinker, debugger, reviewer
- Mini tier: writer, researcher, planner, ops

When adding agents: define in `agents/index.js` — they auto-register in the API and whiteboard.

## Recursive Improvement

When running improvement cycles, each agent has a lane:
- **Coder** owns `server.js` + `agents/index.js`
- **Designer** owns `public/index.html`
- **Ops** owns `CLAUDE.md` + Railway

Never add features during polish cycles — only perfect what exists.

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
