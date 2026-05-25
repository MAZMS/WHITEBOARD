import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { admin } from '../db/adminClient';

export const githubAppWebhookRouter = Router();

function verifyGithubSignature(rawBody: Buffer, signature: string, secret: string): boolean {
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  const expectedBuf = Buffer.from(expected, 'utf8');
  const receivedBuf = Buffer.from(signature, 'utf8');

  if (expectedBuf.length !== receivedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

githubAppWebhookRouter.post('/github-app', async (req: Request, res: Response) => {
  const signature = req.header('X-Hub-Signature-256');
  const secret = process.env.GITHUB_APP_WEBHOOK_SECRET;

  if (!signature || !secret || !verifyGithubSignature(req.body as Buffer, signature, secret)) {
    res.status(401).send('invalid signature');
    return;
  }

  const event = JSON.parse((req.body as Buffer).toString('utf8'));
  const action = req.header('X-GitHub-Event');

  if (action === 'push') {
    const commits = event.commits || [];
    for (const commit of commits) {
      for (const modified of [...(commit.modified || []), ...(commit.added || [])]) {
        if (modified.startsWith('feedback/done/') || modified.startsWith('feedback/rejected/')) {
          const feedbackId = extractFeedbackId(modified);
          if (feedbackId) {
            const newStatus = modified.startsWith('feedback/done/') ? 'REFACTORED' : 'REJECTED';
            await admin.feedback.update({
              where: { id: feedbackId },
              data: { status: newStatus },
            }).catch(() => { /* feedback may not exist */ });
          }
        }
      }
    }
  }

  res.status(200).send('ok');
});

function extractFeedbackId(filePath: string): string | null {
  const match = filePath.match(/\d{4}-\d{2}-\d{2}-(.+)\.md$/);
  return match ? match[1] : null;
}
