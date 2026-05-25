import { Request, Response } from 'express';
import { verifyLemonSqueezySignature } from './verifySignature';
import { calculateSplit } from './splitPayout';
import { admin } from '../db/adminClient';

async function dispatch(
  event: { meta: { event_name: string; custom_data?: { affiliate_code?: string } }; data: { attributes: { total: number; first_order_item?: { price: number } } } },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
) {
  const eventName = event.meta.event_name;

  if (eventName === 'order_created' || eventName === 'subscription_payment_success') {
    const revenue = (event.data.attributes.total || 0) / 100;
    const affiliateCode = event.meta.custom_data?.affiliate_code || null;
    const hasAffiliate = !!affiliateCode;
    const split = calculateSplit(revenue, hasAffiliate);

    const creator = affiliateCode
      ? await tx.creator.findFirst({ where: { blueprints: { some: {} } } })
      : await tx.creator.findFirst({ where: { blueprints: { some: {} } } });

    await tx.payoutRecord.create({
      data: {
        eventId: `${eventName}:${Date.now()}`,
        revenue,
        platformShare: split.platformShare,
        creatorShare: split.creatorShare,
        affiliateShare: split.affiliateShare,
        creatorId: creator?.id || 'unknown',
        affiliateCode,
      },
    });
  }
}

export async function handleWebhook(req: Request, res: Response): Promise<void> {
  const sig = req.header('X-Signature');
  if (!sig || !verifyLemonSqueezySignature(req.body as Buffer, sig, process.env.LEMONSQUEEZY_WEBHOOK_SECRET!)) {
    res.status(401).send('invalid signature');
    return;
  }

  const event = JSON.parse((req.body as Buffer).toString('utf8'));
  const eventId = event.meta.event_name + ':' + event.data.id + ':' + (event.meta.webhook_id || '');

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await admin.$transaction(async (tx: any) => {
      await tx.webhookEvent.create({
        data: { id: eventId, type: event.meta.event_name, payload: event },
      });
      await dispatch(event, tx);
    });
    res.status(200).send('ok');
  } catch (e: unknown) {
    const prismaError = e as { code?: string };
    if (prismaError.code === 'P2002') {
      res.status(200).send('duplicate ignored');
      return;
    }
    throw e;
  }
}
