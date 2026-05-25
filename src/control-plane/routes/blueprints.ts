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
