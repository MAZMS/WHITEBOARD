import { getAppOctokit } from '../github-app/app';

const [owner, repo] = (process.env.GITHUB_FEEDBACK_REPO || 'yourname/greatlibrary-core').split('/');
const branch = process.env.GITHUB_FEEDBACK_BRANCH || 'main';

export async function mirrorFeedbackToRepo(fb: {
  id: string;
  userId: string;
  email: string;
  text: string;
  createdAt: Date;
}): Promise<void> {
  const octokit = await getAppOctokit();
  const date = fb.createdAt.toISOString().slice(0, 10);
  const path = `feedback/inbox/${date}-${fb.id}.md`;

  const content = [
    '---',
    `id: ${fb.id}`,
    `userId: ${fb.userId}`,
    `email: ${fb.email}`,
    `createdAt: ${fb.createdAt.toISOString()}`,
    'status: PENDING',
    '---',
    '',
    fb.text,
    '',
  ].join('\n');

  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    branch,
    message: `feedback: ${fb.id}`,
    content: Buffer.from(content, 'utf8').toString('base64') as string,
  });
}
