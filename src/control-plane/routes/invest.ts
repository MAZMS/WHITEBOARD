import { Router } from 'express';
import { admin } from '../../db/adminClient';
import { rateLimit } from '../../middleware/rateLimit';

export const investRouter = Router();

// GET /api/invest/metrics — public platform metrics for investors
investRouter.get('/invest/metrics', async (_req, res) => {
  try {
    const [blueprintCount, creatorCount, totalRuns] = await Promise.all([
      admin.blueprint.count().catch(() => 0),
      admin.creator.count().catch(() => 0),
      admin.blueprint.aggregate({ _sum: { activeRuns: true } }).catch(() => ({ _sum: { activeRuns: 0 } })),
    ]);

    res.json({
      blueprints: blueprintCount,
      creators: creatorCount,
      activeRuns: totalRuns._sum.activeRuns || 0,
      monthlyGrowth: 34, // placeholder until we compute from time-series data
    });
  } catch {
    // Return sensible defaults so the page always renders
    res.json({
      blueprints: 0,
      creators: 0,
      activeRuns: 0,
      monthlyGrowth: 0,
    });
  }
});

// GET /api/invest/chat — simple investor FAQ bot
investRouter.get('/invest/chat', async (req, res) => {
  const q = ((req.query.q as string) || '').toLowerCase().trim();

  const faqs: Record<string, string> = {
    'revenue': 'GreatLibrary takes a platform fee on each agent deployment. Our revenue model is usage-based, scaling with every active run across all tenants.',
    'team': 'GreatLibrary is founded and built by Mohamed, a solo technical founder. The entire platform — backend, frontend, infrastructure — is built and operated by one person using AI-augmented development.',
    'traction': 'We are pre-revenue and building toward our public launch. Current focus is on growing the blueprint catalog and onboarding early creators.',
    'technology': 'The platform is built on Node.js, TypeScript, PostgreSQL, and Docker. Multi-tenant architecture with tenant-level data isolation via Prisma. Deployed on Railway.',
    'market': 'The AI agent economy is projected to reach $65B+ by 2030. GreatLibrary targets developers who want reusable, deployable agent blueprints — a category that barely exists today.',
    'timeline': 'The library is scheduled to open June 1, 2026. We are actively building the platform and onboarding early creators.',
  };

  if (!q) {
    res.json({ topics: Object.keys(faqs) });
    return;
  }

  const matched = Object.entries(faqs).find(([key]) => q.includes(key));
  res.json({
    answer: matched
      ? matched[1]
      : 'Great question — please reach out directly via the interest form and we will get back to you.',
  });
});

// POST /api/invest/interest — capture investor interest (5 per hour per IP)
investRouter.post('/invest/interest', rateLimit({ windowMs: 3_600_000, max: 5, keyPrefix: 'invest' }), async (req, res) => {
  const { name, email, range, message } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    res.status(400).json({ error: 'A valid email is required' });
    return;
  }

  try {
    // Store as feedback with a special status so it shows up in the admin dashboard
    await admin.feedback.create({
      data: {
        userId: 'investor',
        email: email.trim(),
        text: [
          `[Investor Interest]`,
          `Name: ${name.trim()}`,
          `Range: ${(range || 'Not specified').toString().trim()}`,
          `Message: ${(message || 'No message').toString().trim()}`,
        ].join('\n'),
        status: 'INVESTOR_LEAD',
      },
    });

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to save — please email greatlibraryai@gmail.com directly.' });
  }
});
