import { Router } from 'express';
import { admin } from '../../db/adminClient';
import { AuthenticatedRequest, requireRole } from '../middleware';

export const adminRouter = Router();

adminRouter.use(requireRole('OWNER', 'ADMIN'));

adminRouter.get('/admin/stats', async (_req, res) => {
  try {
    const [blueprintCount, creatorCount, pendingCount, totalRuns] = await Promise.all([
      admin.blueprint.count(),
      admin.creator.count(),
      admin.feedback.count({ where: { status: 'PENDING' } }),
      admin.blueprint.aggregate({ _sum: { activeRuns: true } }),
    ]);

    res.json({
      blueprints: blueprintCount,
      creators: creatorCount,
      pendingFeedback: pendingCount,
      activeRuns: totalRuns._sum.activeRuns || 0,
    });
  } catch {
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

adminRouter.get('/admin/feedback', async (req, res) => {
  const status = req.query.status as string | undefined;
  const where = status ? { status } : {};

  try {
    const items = await admin.feedback.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json(items);
  } catch {
    res.status(500).json({ error: 'Failed to load feedback' });
  }
});

adminRouter.patch('/admin/feedback/:id', async (req: AuthenticatedRequest, res) => {
  const { status, analysis } = req.body;

  if (!status || typeof status !== 'string') {
    res.status(400).json({ error: 'status is required' });
    return;
  }

  try {
    const updated = await admin.feedback.update({
      where: { id: req.params.id },
      data: {
        status,
        ...(analysis ? { analysis } : {}),
      },
    });
    res.json(updated);
  } catch {
    res.status(404).json({ error: 'Feedback not found' });
  }
});

adminRouter.get('/admin/traffic', async (req, res) => {
  const days = parseInt(req.query.days as string) || 7;
  const since = new Date();
  since.setDate(since.getDate() - days);

  try {
    const metrics = await admin.webTrafficMetric.groupBy({
      by: ['path'],
      _count: { id: true },
      where: { timestamp: { gte: since } },
      orderBy: { _count: { id: 'desc' } },
      take: 20,
    });

    const uniqueVisitors = await admin.webTrafficMetric.groupBy({
      by: ['visitorId'],
      where: { timestamp: { gte: since } },
    });

    res.json({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      topPages: metrics.map((m: any) => ({ path: m.path, views: m._count.id })),
      uniqueVisitors: uniqueVisitors.length,
      period: days,
    });
  } catch {
    res.status(500).json({ error: 'Failed to load traffic' });
  }
});
