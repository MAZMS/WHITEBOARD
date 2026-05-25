import { Octokit } from '@octokit/rest';
import { getInstallationToken } from './auth';

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getAppOctokit(): Promise<Octokit> {
  const now = Date.now();

  if (cachedToken && cachedToken.expiresAt > now + 60000) {
    return new Octokit({ auth: cachedToken.token });
  }

  // Fallback to PAT if GitHub App is not configured
  if (!process.env.GITHUB_APP_ID || !process.env.GITHUB_APP_PRIVATE_KEY) {
    const pat = process.env.GITHUB_FEEDBACK_BOT_TOKEN;
    if (!pat) {
      throw new Error('Neither GitHub App nor GITHUB_FEEDBACK_BOT_TOKEN configured');
    }
    return new Octokit({ auth: pat });
  }

  const token = await getInstallationToken();
  cachedToken = { token, expiresAt: now + 55 * 60 * 1000 };
  return new Octokit({ auth: token });
}
