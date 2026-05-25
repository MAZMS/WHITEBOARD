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

blueprintRouter.get('/creators/:username', async (req, res) => {
  try {
    const creator = await admin.creator.findUnique({
      where: { username: req.params.username },
    });
    if (!creator) {
      res.status(404).json({ error: 'Creator not found' });
      return;
    }
    const blueprints = await admin.blueprint.findMany({
      where: { creatorId: creator.id },
      include: { creator: { select: { username: true } } },
      orderBy: { activeRuns: 'desc' },
    });
    const totalRuns = blueprints.reduce((sum: number, b: { activeRuns: number }) => sum + b.activeRuns, 0);
    const avgStability = blueprints.length > 0
      ? Math.round(blueprints.reduce((sum: number, b: { stability: number }) => sum + b.stability, 0) / blueprints.length * 10) / 10
      : 0;
    res.json({
      creator: {
        id: creator.id,
        username: creator.username,
        email: creator.email,
        createdAt: creator.createdAt,
      },
      blueprints,
      stats: {
        totalRuns,
        avgStability,
        blueprintCount: blueprints.length,
      },
    });
  } catch {
    res.status(500).json({ error: 'Service unavailable' });
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
