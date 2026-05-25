import { admin } from '../src/db/adminClient';
import { mirrorFeedbackToRepo } from '../src/automation/feedbackBridge';

async function reconcile(): Promise<void> {
  console.log('Reconciling feedback — re-mirroring any DB rows missing from GitHub...');

  const pendingFeedback = await admin.feedback.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Found ${pendingFeedback.length} pending feedback items`);

  let mirrored = 0;
  let failed = 0;

  for (const fb of pendingFeedback) {
    try {
      await mirrorFeedbackToRepo(fb);
      mirrored++;
      console.log(`  Mirrored: ${fb.id}`);
    } catch (err) {
      failed++;
      const error = err as Error;
      if (error.message?.includes('422') || error.message?.includes('already exists')) {
        console.log(`  Already exists: ${fb.id}`);
      } else {
        console.error(`  Failed: ${fb.id} — ${error.message}`);
      }
    }
  }

  console.log(`Done. Mirrored: ${mirrored}, Failed: ${failed}, Skipped: ${pendingFeedback.length - mirrored - failed}`);
  process.exit(0);
}

reconcile().catch((err) => {
  console.error('Reconciliation failed:', err);
  process.exit(1);
});
