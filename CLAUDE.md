# Whiteboard Agent System — Rules for Claude Code

You are building a real-time whiteboard + AI agent platform at **greatlibrary.ai**.
These rules are recursive — they shape how YOU work AND how agents on the board work.

## The Operator

Maz (MAZMS). Solo founder. Works fast, thinks visually, delegates everything.

- He sends screenshots — read them, understand them, act.
- He says "do it" — that means DO IT, don't ask for clarification.
- He works on Claude Max — maximize every session. Never idle.
- After every meaningful change: **commit + push to main**.
- Railway auto-deploys from main. Check `railway logs` if it crashes.

## How to Work

1. **Read before writing.** Never edit blind. Understand the file first.
2. **Launch agents in parallel.** If tasks are independent, run them simultaneously.
3. **Background agents get full context.** They haven't seen the conversation.
4. **Ship fast, fix fast.** Push to main → check Railway → fix if broken.
5. **Pick the next task automatically.** Don't wait for instructions.
6. **Simple > clever.** If it works and it's readable, it's done.
7. **No feature creep.** Build what was asked. Nothing more.

## Architecture

```
greatlibraryai/
├── server.js          # Express server — routes, OpenAI proxy, token tracking
├── public/
│   ├── index.html     # Whiteboard — canvas + agent cards + command bar
│   └── admin.html     # Admin — token tracker, model picker, request history
├── agents/            # Agent definitions (system prompts, capabilities)
├── package.json
├── .env.example       # OPENAI_API_KEY, ADMIN_PASSWORD, PORT
└── CLAUDE.md          # This file
```

## Invariants

1. **No build step.** Plain HTML + CSS + vanilla JS in `public/`. No React, no bundler.
2. **Pure black and white.** #000 background, #fff text, #333 borders. No color.
3. **Secrets in `process.env` only.** Never commit, log, or echo API keys.
4. **Token tracking is mandatory.** Every OpenAI call MUST log to the usage tracker.
5. **Daily limits are sacred:**
   - Premium models (gpt-5.4, gpt-5, gpt-4.1, o1, o3): **250,000 tokens/day**
   - Mini models (gpt-5.4-mini, gpt-4o-mini, o4-mini): **2,500,000 tokens/day**
6. **Admin at `/admin`** — always accessible, always shows real-time usage.
7. **New env var → add to `.env.example`** in the same commit.

## Design Rules

- Smooth animations (cubic-bezier transitions). Never abrupt.
- No visible scrollbars. `scrollbar-width: none` everywhere.
- Mobile-friendly. Touch targets ≥ 44px. No horizontal overflow.
- Monospace font stack: `'SF Mono', 'Fira Code', 'Consolas', monospace`.
- Every interaction should feel instant. Optimistic UI.
- Agent cards are draggable, closeable, self-contained.

## Agent System

Agents are AI-powered cards on the whiteboard. Each has:
- A name and system prompt
- A chat input that streams OpenAI responses
- Status indicators (Ready → Thinking → Streaming → Done)
- Token usage tracked per-request

When creating new agent types:
- Add system prompt to `agents/` directory
- Register in `server.js` agent routes
- Keep prompts concise — under 200 words
- Each agent has a clear, distinct purpose

## Recursive Learning

This file evolves. When Mohamed gives feedback:
1. If it's about how Claude should work → update this CLAUDE.md
2. If it's about design/UX → update the Design Rules section above
3. If it's about the product → update Architecture or Agent System section
4. If it's a personal preference → save to memory system

The system gets smarter with every conversation. Rules compound.
Nothing is static. Everything adapts.

## Railway Deployment

- Domain: **greatlibrary.ai**
- Service: `greatlibraryai` on Railway
- Auto-deploys on push to `main`
- Commands: `railway status`, `railway logs`, `railway variables`
- Build: `npm install` → `npm start` (node server.js)
- After pushing, always verify with `railway status` + `railway logs`

## When in Doubt

- Ship it. Fix later.
- Simple beats clever.
- Black and white. Always.
- Commit and push. Always.
- Check Railway. Always.
