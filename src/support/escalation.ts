import { Router } from 'express';
import { triageSupport } from './assistant';

export const supportRouter = Router();

supportRouter.post('/support', async (req, res) => {
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
  } catch {
    res.status(500).json({ error: 'Support service unavailable' });
  }
});
