import express from 'express';
import path from 'path';
import { webhookRouter } from './control-plane/routes/webhooks';
import { githubAppWebhookRouter } from './github-app/webhooks';
import { authRouter } from './control-plane/routes/auth';
import { workspaceRouter } from './control-plane/routes/workspaces';
import { blueprintRouter } from './control-plane/routes/blueprints';
import { feedbackRouter } from './control-plane/routes/feedback';
import { adminRouter } from './control-plane/routes/admin';
import { supportRouter } from './support/escalation';
import { investRouter } from './control-plane/routes/invest';
import { analyticsMiddleware } from './middleware/analytics';
import { authMiddleware } from './control-plane/middleware';

const app = express();
const PORT = process.env.PORT || 3000;

// 0. Health check — before all middleware for fast responses (Railway health checks)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// 1. Webhook routers FIRST — use raw body parser, must come before express.json
app.use('/webhooks', express.raw({ type: 'application/json' }), webhookRouter);
app.use('/webhooks', express.raw({ type: 'application/json' }), githubAppWebhookRouter);

// 2. JSON parser for everything else
app.use(express.json());

// 3. Analytics middleware (non-blocking)
app.use(analyticsMiddleware);

// 4. Auth routes (public)
app.use('/auth', authRouter);

// 5. Blueprint routes — public listing, protected mutations
app.use('/api', blueprintRouter);

// 6. Support chat (public)
app.use('/api', supportRouter);

// 6b. Investor routes (public)
app.use('/api', investRouter);

// 7. Protected routes
app.use('/api', authMiddleware, workspaceRouter);
app.use('/api', authMiddleware, feedbackRouter);
app.use('/api', authMiddleware, adminRouter);

// 7. Static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// 8. OpenGraph route for blueprints
app.get('/b/:slug', async (req, res) => {
  try {
    const { admin } = await import('./db/adminClient');
    const bp = await admin.blueprint.findUnique({
      where: { slug: req.params.slug },
    });
    if (!bp) {
      res.status(404).send('Not found');
      return;
    }
    res.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta property="og:title" content="${bp.name}" />
  <meta property="og:description" content="${bp.description.slice(0, 200)}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${process.env.NEXTAUTH_URL || ''}/b/${bp.slug}" />
  <title>${bp.name} — GreatLibrary</title>
  <meta http-equiv="refresh" content="0;url=/?blueprint=${bp.slug}" />
</head>
<body></body>
</html>`);
  } catch {
    res.status(500).send('Internal server error');
  }
});

// 9. Catch-all 404 for unmatched routes
app.use((_req, res) => {
  res.status(404).sendFile(path.join(__dirname, '..', 'public', '404.html'));
});

async function seedIfEmpty(): Promise<void> {
  try {
    const { admin } = await import('./db/adminClient');
    const count = await admin.blueprint.count();
    if (count > 0) {
      console.log(`Database has ${count} blueprints — skipping seed.`);
      return;
    }
    console.log('Database empty — seeding blueprints...');
    const { seedDatabase } = await import('./db/seed');
    await seedDatabase(admin);
    console.log('Seed complete.');
  } catch (e) {
    console.error('Seed skipped (DB not ready):', (e as Error).message);
  }
}

app.listen(PORT, async () => {
  console.log(`GreatLibrary server running on port ${PORT}`);
  await seedIfEmpty();
});

export { app };
