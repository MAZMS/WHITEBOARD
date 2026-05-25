import { Router } from 'express';
import { admin } from '../../db/adminClient';
import { mirrorFeedbackToRepo } from '../../automation/feedbackBridge';
import { AuthenticatedRequest } from '../middleware';
import { logError } from '../../middleware/logger';

export const feedbackRouter = Router();

feedbackRouter.post('/feedback', async (req, res) => {
  const user = (req as AuthenticatedRequest).user;
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const { text } = req.body;
  if (!text || typeof text !== 'string') {
    res.status(400).json({ error: 'text is required' });
    return;
  }

  const fb = await admin.feedback.create({
    data: { userId: user.id, email: user.email, text },
  });

  mirrorFeedbackToRepo(fb).catch((err) => logError('Feedback mirror failed', { error: (err as Error).message }));

  res.json({ ok: true, id: fb.id });
});

feedbackRouter.get('/feedback', async (req, res) => {
  const user = (req as AuthenticatedRequest).user;
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const items = await admin.feedback.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
  });
  res.json(items);
});
