import jwt from 'jsonwebtoken';
import { Octokit } from '@octokit/rest';

export function generateAppJwt(): string {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;

  if (!appId || !privateKey) {
    throw new Error('GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required');
  }

  const key = Buffer.from(privateKey, 'base64').toString('utf8');
  const now = Math.floor(Date.now() / 1000);

  return jwt.sign(
    {
      iat: now - 60,
      exp: now + 600,
      iss: appId,
    },
    key,
    { algorithm: 'RS256' },
  );
}

export async function getInstallationToken(): Promise<string> {
  const installationId = process.env.GITHUB_APP_INSTALLATION_ID;
  if (!installationId) {
    throw new Error('GITHUB_APP_INSTALLATION_ID is required');
  }

  const appJwt = generateAppJwt();
  const octokit = new Octokit({ auth: appJwt });

  const { data } = await octokit.apps.createInstallationAccessToken({
    installation_id: parseInt(installationId, 10),
  });

  return data.token;
}
