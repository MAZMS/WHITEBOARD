import { Router } from 'express';
import { admin } from '../../db/adminClient';

export const blueprintRouter = Router();

blueprintRouter.get('/blueprints', async (_req, res) => {
  try {
    const blueprints = await admin.blueprint.findMany({
      include: { creator: { select: { username: true } } },
      orderBy: { activeRuns: 'desc' },
    });
    res.json(blueprints);
  } catch {
    res.json([]);
  }
});

blueprintRouter.get('/blueprints/search', async (req, res) => {
  try {
    const q = (req.query.q as string || '').trim();
    const where = q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' as const } },
            { description: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const blueprints = await admin.blueprint.findMany({
      where,
      include: { creator: { select: { username: true } } },
      orderBy: { activeRuns: 'desc' },
    });
    res.json(blueprints);
  } catch {
    res.json([]);
  }
});

blueprintRouter.get('/blueprints/:slug', async (req, res) => {
  try {
    const blueprint = await admin.blueprint.findUnique({
      where: { slug: req.params.slug },
      include: { creator: { select: { username: true, email: true } } },
    });
    if (!blueprint) {
      res.status(404).json({ error: 'Blueprint not found' });
      return;
    }
    res.json(blueprint);
  } catch {
    res.status(500).json({ error: 'Service unavailable' });
  }
});
