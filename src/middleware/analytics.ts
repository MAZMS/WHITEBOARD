import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { admin } from '../db/adminClient';

interface MetricEntry {
  visitorId: string;
  sessionId: string;
  path: string;
  referrer: string | null;
  userAgent: string | null;
  ipAddress: string | null;
}

const queue: MetricEntry[] = [];
const FLUSH_INTERVAL = 5000;
const BATCH_SIZE = 100;

function dailySecret(): string {
  const day = new Date().toISOString().slice(0, 10);
  return crypto
    .createHash('sha256')
    .update((process.env.ANALYTICS_DAILY_SECRET || 'dev-analytics-secret') + day)
    .digest('hex');
}

function hashId(ip: string, ua: string): string {
  return crypto
    .createHash('sha256')
    .update(ip + ua + dailySecret())
    .digest('hex')
    .slice(0, 32);
}

async function flushQueue(): Promise<void> {
  if (queue.length === 0) return;

  const batch = queue.splice(0, BATCH_SIZE);
  try {
    await admin.webTrafficMetric.createMany({
      data: batch,
    });
  } catch {
    // Drop on persistent failure to avoid unbounded growth
    if (queue.length > BATCH_SIZE * 10) {
      queue.length = 0;
    } else {
      queue.unshift(...batch);
    }
  }
}

setInterval(flushQueue, FLUSH_INTERVAL);

export function analyticsMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const ip = req.ip || req.socket.remoteAddress || '';
  const ua = req.get('user-agent') || '';
  const visitorId = hashId(ip, ua);
  const sessionId = crypto.randomUUID();

  queue.push({
    visitorId,
    sessionId,
    path: req.path,
    referrer: req.get('referer') || null,
    userAgent: ua || null,
    ipAddress: null,
  });

  next();
}
