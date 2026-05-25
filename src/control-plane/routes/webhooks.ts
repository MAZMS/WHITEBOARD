import { Router } from 'express';
import { handleWebhook } from '../../payments/handleWebhook';

export const webhookRouter = Router();

webhookRouter.post('/lemonsqueezy', handleWebhook);
