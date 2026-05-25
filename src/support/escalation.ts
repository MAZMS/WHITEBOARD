import { Router } from 'express';
import { triageSupport } from './assistant';
import { rateLimit } from '../middleware/rateLimit';
import { logError } from '../middleware/logger';

export const supportRouter = Router();

// 10 messages per minute per IP
supportRouter.post('/support', rateLimit({ windowMs: 60_000, max: 10, keyPrefix: 'support' }), async (req, res) => {
  const { message, logs } = req.body;
  if (!message || typeof message !== 'string') {
    res.status(400).json({ error: 'message is required' });
    return;
  }

  try {
    const reply = await triageSupport(message, logs);
    res.json({
      reply,
      escalated: reply === 'ESCALATION_TRIGGER',
      supportEmail: reply === 'ESCALATION_TRIGGER'
        ? (process.env.SUPPORT_ESCALATION_EMAIL || 'support@greatlibrary.ai')
        : undefined,
    });
  } catch (err) {
    logError('Support triage failed', { error: (err as Error).message });
    res.status(500).json({ error: 'Support service unavailable' });
  }
});
