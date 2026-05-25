# GreatLibrary — Working Rules for Claude Code

You are working in a multi-tenant SaaS codebase. Read these rules before every
non-trivial edit.

## Invariants
1. No build step on the frontend. Plain HTML + Alpine.js (CDN) + Tailwind (CDN).
2. All tenant data goes through `getTenantPrisma(tenantId)`. Never import the
   raw tenant Prisma client elsewhere.
3. Webhook routes use the raw body parser. `express.json()` must never apply to
   `/webhooks/*`.
4. Every webhook handler writes its `eventId` to `webhook_events` for
   idempotency — inside the same transaction as the side effect.
5. Secrets come from `process.env` only. Never commit, log, or echo secret
   values. `.env.example` is the only env file in Git.
6. Docker provisioning goes through `src/orchestrator/provision.ts`. Route
   handlers do not import `dockerode`.
7. Tests must pass before any commit.

## Feedback inbox workflow
- `feedback/inbox/*.md` — items awaiting review. Each file has YAML frontmatter
  (id, userId, email, createdAt, status) followed by the user's message.
- `feedback/done/` — processed items. When you fix something from an inbox item,
  MOVE the file here (do not delete) and append a `## Resolution` section at the
  bottom with a short note and the files you touched.
- `feedback/rejected/` — won't-fix, dupes, spam. Move the file here with a
  `## Rejection reason` section.
- If you can't decide what to do, leave the file in `inbox/` and add
  `> NEEDS_OPERATOR: <your one-line question>` at the top.
- Never delete a feedback file. Move, don't delete.

## Style
- TypeScript strict mode.
- No `any` without a justification comment.
- Prefer narrow imports (`import { X } from`) over namespace imports.
- 2-space indent. Single quotes. Trailing commas. Semicolons on.

## Railway deployment
- The app is deployed to Railway at **greatlibrary.ai**.
- Railway CLI is installed globally — always use it to check status, logs, and
  deploy issues. Do not guess at deployment problems.
- Common commands:
  - `railway status` — check service status (online/crashed/deploying)
  - `railway logs` — read recent deploy & runtime logs
  - `railway logs -n 50` — read more lines
  - `railway variables` — list env vars (never echo values)
  - `railway up` — manual deploy from local (prefer git push)
- After every push to `main`, check `railway status` to confirm the deploy
  succeeded. If it crashes, read `railway logs` and fix immediately.
- Build pipeline: `npm install` → `postinstall` (prisma generate) → `npm run
  build` (tsc) → `npm start` (node dist/src/server.js).

## When in doubt
- Tenant data → RLS factory.
- New route → check whether it needs auth middleware before writing it.
- New env var → add to `.env.example` in the same commit.
- New schema field → write a migration; never edit existing migrations.
- Touching `.env*`, `prisma-*/migrations/`, or anything in `feedback/done/` and
  `feedback/rejected/` → ask the operator first.
